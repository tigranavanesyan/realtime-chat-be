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
        const { receiverId, content, type, fileUrl, fileName } = data;

        const message = new Message({
          sender: userId,
          receiver: receiverId,
          content,
          type: type || 'text',
          fileUrl,
          fileName
        });

        await message.save();
        await message.populate('sender', 'username avatar');

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
        const { groupId, content, type, fileUrl, fileName } = data;

        const message = new Message({
          sender: userId,
          group: groupId,
          content,
          type: type || 'text',
          fileUrl,
          fileName
        });

        await message.save();
        await message.populate('sender', 'username avatar');

        // Send to all group members
        io.to(`group:${groupId}`).emit('receive-group-message', message);
      } catch (error) {
        socket.emit('error', { message: 'Failed to send group message' });
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
