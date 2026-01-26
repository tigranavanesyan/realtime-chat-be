import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import User from './models/User';
import Message from './models/Message';
import Group from './models/Group';

interface SocketUser {
  userId: string;
  socketId: string;
  username: string;
}

const connectedUsers: Map<string, SocketUser> = new Map();

export const setupSocketIO = (io: Server) => {
  io.use(async (socket: Socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication error'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as any;
      const user = await User.findById(decoded.userId);
      
      if (!user) {
        return next(new Error('User not found'));
      }

      (socket as any).userId = user._id.toString();
      (socket as any).username = user.username;
      next();
    } catch (error) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', async (socket: Socket) => {
    const userId = (socket as any).userId;
    const username = (socket as any).username;

    // Add user to connected users
    connectedUsers.set(userId, {
      userId,
      socketId: socket.id,
      username
    });

    // Update user online status
    await User.findByIdAndUpdate(userId, { isOnline: true });

    // Notify others that user is online
    socket.broadcast.emit('user-online', { userId, username });

    // Join user to their personal room
    socket.join(`user:${userId}`);

    // Get user groups and join them
    const groups = await Group.find({ members: userId });
    groups.forEach(group => {
      socket.join(`group:${group._id}`);
    });

    // Handle private message
    socket.on('send-message', async (data) => {
      try {
        const { receiverId, content, type, fileUrl, fileName, replyTo } = data;

        const message = new Message({
          sender: userId,
          receiver: receiverId,
          content,
          type: type || 'text',
          fileUrl,
          fileName,
          replyTo
        });

        await message.save();
        await message.populate('sender', 'username avatar');
        if (message.replyTo) {
          await message.populate({
            path: 'replyTo',
            select: 'content sender',
            populate: {
              path: 'sender',
              select: 'username avatar'
            }
          });
        }

        // Send to receiver
        io.to(`user:${receiverId}`).emit('receive-message', message);

        // Send confirmation to sender
        socket.emit('message-sent', message);
      } catch (error) {
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Handle group message
    socket.on('send-group-message', async (data) => {
      try {
        const { groupId, content, type, fileUrl, fileName, replyTo } = data;

        const message = new Message({
          sender: userId,
          group: groupId,
          content,
          type: type || 'text',
          fileUrl,
          fileName,
          replyTo
        });

        await message.save();
        await message.populate('sender', 'username avatar');
        if (message.replyTo) {
          await message.populate({
            path: 'replyTo',
            select: 'content sender',
            populate: {
              path: 'sender',
              select: 'username avatar'
            }
          });
        }

        // Send to all group members
        io.to(`group:${groupId}`).emit('receive-group-message', message);
      } catch (error) {
        socket.emit('error', { message: 'Failed to send group message' });
      }
    });

    // Handle edit message
    socket.on('edit-message', async (data) => {
      try {
        const { messageId, content } = data;

        const message = await Message.findById(messageId);
        if (!message) {
          return socket.emit('error', { message: 'Message not found' });
        }

        // Check if user is the sender
        if (message.sender.toString() !== userId) {
          return socket.emit('error', { message: 'You can only edit your own messages' });
        }

        if (message.deleted) {
          return socket.emit('error', { message: 'Cannot edit deleted message' });
        }

        message.content = content;
        message.edited = true;
        message.editedAt = new Date();
        await message.save();
        await message.populate('sender', 'username avatar');
        if (message.replyTo) {
          await message.populate({
            path: 'replyTo',
            select: 'content sender',
            populate: {
              path: 'sender',
              select: 'username avatar'
            }
          });
        }

        // Emit to receiver or group
        if (message.receiver) {
          io.to(`user:${message.receiver}`).emit('message-edited', message);
          socket.emit('message-edited', message);
        } else if (message.group) {
          io.to(`group:${message.group}`).emit('message-edited', message);
        }
      } catch (error) {
        socket.emit('error', { message: 'Failed to edit message' });
      }
    });

    // Handle delete message
    socket.on('delete-message', async (data) => {
      try {
        const { messageId } = data;

        const message = await Message.findById(messageId);
        if (!message) {
          return socket.emit('error', { message: 'Message not found' });
        }

        // Check if user is the sender
        if (message.sender.toString() !== userId) {
          return socket.emit('error', { message: 'You can only delete your own messages' });
        }

        message.deleted = true;
        message.deletedAt = new Date();
        message.content = 'This message was deleted';
        await message.save();
        await message.populate('sender', 'username avatar');

        // Emit to receiver or group
        if (message.receiver) {
          io.to(`user:${message.receiver}`).emit('message-deleted', message);
          socket.emit('message-deleted', message);
        } else if (message.group) {
          io.to(`group:${message.group}`).emit('message-deleted', message);
        }
      } catch (error) {
        socket.emit('error', { message: 'Failed to delete message' });
      }
    });

    // Handle typing indicator
    socket.on('typing', (data) => {
      const { receiverId, isTyping } = data;
      socket.to(`user:${receiverId}`).emit('user-typing', {
        userId,
        username,
        isTyping
      });
    });

    // Handle group typing
    socket.on('group-typing', (data) => {
      const { groupId, isTyping } = data;
      socket.to(`group:${groupId}`).emit('user-group-typing', {
        userId,
        username,
        isTyping
      });
    });

    // Handle disconnect
    socket.on('disconnect', async () => {
      connectedUsers.delete(userId);
      await User.findByIdAndUpdate(userId, { 
        isOnline: false, 
        lastSeen: new Date() 
      });

      socket.broadcast.emit('user-offline', { userId, username });
    });
  });
};
