import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { setupSocketIO } from '../socket';
import User from '../models/User';
import Message from '../models/Message';
import Group from '../models/Group';

// Mock dependencies
jest.mock('jsonwebtoken');
jest.mock('../models/User');
jest.mock('../models/Message');
jest.mock('../models/Group');

describe('Socket.IO Setup', () => {
  let mockIo: Partial<Server>;
  let mockSocket: Partial<Socket>;
  let mockEmit: jest.Mock;
  let mockOn: jest.Mock;
  let mockJoin: jest.Mock;
  let mockTo: jest.Mock;
  let mockBroadcast: Partial<Socket>;
  let mockBroadcastEmit: jest.Mock;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup socket mocks
    mockEmit = jest.fn();
    mockOn = jest.fn((event: string, callback: Function) => {
      if (event === 'connection') {
        // Store connection callback for later invocation
        (mockIo as any)._connectionCallback = callback;
      }
      return mockSocket as Socket;
    });
    mockJoin = jest.fn();
    mockBroadcastEmit = jest.fn();
    mockTo = jest.fn(() => ({
      emit: mockEmit,
    }));

    mockBroadcast = {
      emit: mockBroadcastEmit,
    };

    mockSocket = {
      id: 'socket-id-123',
      handshake: {
        auth: {
          token: 'valid-token',
        },
      } as any,
      emit: mockEmit,
      on: mockOn,
      join: mockJoin,
      to: mockTo,
      broadcast: mockBroadcast as any,
    } as any;

    mockIo = {
      use: jest.fn((middleware: Function) => {
        // Store middleware for later invocation
        (mockIo as any)._middleware = middleware;
        return mockIo as Server;
      }),
      on: mockOn,
      to: mockTo,
    };
  });

  describe('Authentication Middleware', () => {
    it('should authenticate user with valid token', async () => {
      const mockUser = {
        _id: { toString: () => 'user-id-123' },
        username: 'testuser',
      };

      (jwt.verify as jest.Mock).mockReturnValue({ userId: 'user-id-123' });
      (User.findById as jest.Mock).mockResolvedValue(mockUser);

      setupSocketIO(mockIo as Server);

      const middleware = (mockIo as any)._middleware;
      const next = jest.fn();

      await middleware(mockSocket as Socket, next);

      expect(jwt.verify).toHaveBeenCalledWith(
        'valid-token',
        process.env.JWT_SECRET || 'secret'
      );
      expect(User.findById).toHaveBeenCalledWith('user-id-123');
      expect(next).toHaveBeenCalled();
      expect((mockSocket as any).userId).toBe('user-id-123');
      expect((mockSocket as any).username).toBe('testuser');
    });

    it('should reject connection without token', async () => {
      (mockSocket.handshake as any).auth = {};

      setupSocketIO(mockIo as Server);

      const middleware = (mockIo as any)._middleware;
      const next = jest.fn((error?: Error) => {
        expect(error).toBeInstanceOf(Error);
        expect(error?.message).toBe('Authentication error');
      });

      await middleware(mockSocket as Socket, next);
    });

    it('should reject connection with invalid token', async () => {
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid token');
      });

      setupSocketIO(mockIo as Server);

      const middleware = (mockIo as any)._middleware;
      const next = jest.fn((error?: Error) => {
        expect(error).toBeInstanceOf(Error);
        expect(error?.message).toBe('Authentication error');
      });

      await middleware(mockSocket as Socket, next);
    });

    it('should reject connection if user not found', async () => {
      (jwt.verify as jest.Mock).mockReturnValue({ userId: 'user-id-123' });
      (User.findById as jest.Mock).mockResolvedValue(null);

      setupSocketIO(mockIo as Server);

      const middleware = (mockIo as any)._middleware;
      const next = jest.fn((error?: Error) => {
        expect(error).toBeInstanceOf(Error);
        expect(error?.message).toBe('User not found');
      });

      await middleware(mockSocket as Socket, next);
    });
  });

  describe('Connection Handler', () => {
    beforeEach(() => {
      const mockUser = {
        _id: { toString: () => 'user-id-123' },
        username: 'testuser',
      };

      (jwt.verify as jest.Mock).mockReturnValue({ userId: 'user-id-123' });
      (User.findById as jest.Mock).mockResolvedValue(mockUser);
      (User.findByIdAndUpdate as jest.Mock).mockResolvedValue(mockUser);
      (Group.find as jest.Mock).mockResolvedValue([]);
    });

    it('should handle user connection', async () => {
      setupSocketIO(mockIo as Server);

      // Trigger middleware
      const middleware = (mockIo as any)._middleware;
      await middleware(mockSocket as Socket, jest.fn());

      // Trigger connection
      const connectionCallback = (mockIo as any)._connectionCallback;
      await connectionCallback(mockSocket as Socket);

      expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
        'user-id-123',
        { isOnline: true }
      );
      expect(mockJoin).toHaveBeenCalledWith('user:user-id-123');
      expect(mockBroadcastEmit).toHaveBeenCalledWith('user-online', {
        userId: 'user-id-123',
        username: 'testuser',
      });
    });

    it('should join user to their groups', async () => {
      const mockGroups = [
        { _id: { toString: () => 'group-id-1' } },
        { _id: { toString: () => 'group-id-2' } },
      ];

      (Group.find as jest.Mock).mockResolvedValue(mockGroups);

      setupSocketIO(mockIo as Server);

      const middleware = (mockIo as any)._middleware;
      await middleware(mockSocket as Socket, jest.fn());

      const connectionCallback = (mockIo as any)._connectionCallback;
      await connectionCallback(mockSocket as Socket);

      expect(Group.find).toHaveBeenCalledWith({ members: 'user-id-123' });
      expect(mockJoin).toHaveBeenCalledWith('group:group-id-1');
      expect(mockJoin).toHaveBeenCalledWith('group:group-id-2');
    });
  });

  describe('Send Message Handler', () => {
    let connectionCallback: Function;
    let messageHandlers: { [key: string]: Function };

    beforeEach(async () => {
      const mockUser = {
        _id: { toString: () => 'user-id-123' },
        username: 'testuser',
      };

      (jwt.verify as jest.Mock).mockReturnValue({ userId: 'user-id-123' });
      (User.findById as jest.Mock).mockResolvedValue(mockUser);
      (User.findByIdAndUpdate as jest.Mock).mockResolvedValue(mockUser);
      (Group.find as jest.Mock).mockResolvedValue([]);

      setupSocketIO(mockIo as Server);

      const middleware = (mockIo as any)._middleware;
      await middleware(mockSocket as Socket, jest.fn());

      connectionCallback = (mockIo as any)._connectionCallback;
      await connectionCallback(mockSocket as Socket);

      // Capture event handlers
      messageHandlers = {};
      mockOn.mock.calls.forEach(([event, handler]) => {
        if (event !== 'connection') {
          messageHandlers[event] = handler;
        }
      });
    });

    it('should send private message successfully', async () => {
      const mockMessage = {
        _id: 'message-id-123',
        sender: 'user-id-123',
        receiver: 'receiver-id-456',
        content: 'Hello',
        type: 'text',
        save: jest.fn().mockResolvedValue(true),
        populate: jest.fn().mockResolvedValue({
          _id: 'message-id-123',
          sender: { username: 'testuser', avatar: '' },
          receiver: 'receiver-id-456',
          content: 'Hello',
          type: 'text',
        }),
      };

      (Message as any).mockImplementation(() => mockMessage);

      await messageHandlers['send-message']({
        receiverId: 'receiver-id-456',
        content: 'Hello',
        type: 'text',
      });

      expect(Message).toHaveBeenCalledWith({
        sender: 'user-id-123',
        receiver: 'receiver-id-456',
        content: 'Hello',
        type: 'text',
        fileUrl: undefined,
        fileName: undefined,
        replyTo: undefined,
      });
      expect(mockMessage.save).toHaveBeenCalled();
      expect(mockMessage.populate).toHaveBeenCalledWith('sender', 'username avatar');
      expect(mockTo).toHaveBeenCalledWith('user:receiver-id-456');
      expect(mockEmit).toHaveBeenCalledWith('receive-message', expect.any(Object));
      expect(mockSocket.emit).toHaveBeenCalledWith('message-sent', expect.any(Object));
    });

    it('should handle message send error', async () => {
      (Message as any).mockImplementation(() => {
        throw new Error('Database error');
      });

      await messageHandlers['send-message']({
        receiverId: 'receiver-id-456',
        content: 'Hello',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        message: 'Failed to send message',
      });
    });

    it('should send message with reply', async () => {
      const mockMessage = {
        _id: 'message-id-123',
        sender: 'user-id-123',
        receiver: 'receiver-id-456',
        content: 'Reply message',
        replyTo: 'original-message-id',
        save: jest.fn().mockResolvedValue(true),
        populate: jest.fn()
          .mockResolvedValueOnce({
            _id: 'message-id-123',
            sender: { username: 'testuser', avatar: '' },
            receiver: 'receiver-id-456',
            content: 'Reply message',
            replyTo: 'original-message-id',
          })
          .mockResolvedValueOnce({
            _id: 'message-id-123',
            sender: { username: 'testuser', avatar: '' },
            receiver: 'receiver-id-456',
            content: 'Reply message',
            replyTo: {
              content: 'Original message',
              sender: { username: 'otheruser', avatar: '' },
            },
          }),
      };

      (Message as any).mockImplementation(() => mockMessage);

      await messageHandlers['send-message']({
        receiverId: 'receiver-id-456',
        content: 'Reply message',
        replyTo: 'original-message-id',
      });

      expect(mockMessage.populate).toHaveBeenCalledTimes(2);
      expect(mockMessage.populate).toHaveBeenNthCalledWith(2, {
        path: 'replyTo',
        select: 'content sender',
        populate: {
          path: 'sender',
          select: 'username avatar',
        },
      });
    });
  });

  describe('Send Group Message Handler', () => {
    let connectionCallback: Function;
    let messageHandlers: { [key: string]: Function };

    beforeEach(async () => {
      const mockUser = {
        _id: { toString: () => 'user-id-123' },
        username: 'testuser',
      };

      (jwt.verify as jest.Mock).mockReturnValue({ userId: 'user-id-123' });
      (User.findById as jest.Mock).mockResolvedValue(mockUser);
      (User.findByIdAndUpdate as jest.Mock).mockResolvedValue(mockUser);
      (Group.find as jest.Mock).mockResolvedValue([]);

      setupSocketIO(mockIo as Server);

      const middleware = (mockIo as any)._middleware;
      await middleware(mockSocket as Socket, jest.fn());

      connectionCallback = (mockIo as any)._connectionCallback;
      await connectionCallback(mockSocket as Socket);

      messageHandlers = {};
      mockOn.mock.calls.forEach(([event, handler]) => {
        if (event !== 'connection') {
          messageHandlers[event] = handler;
        }
      });
    });

    it('should send group message successfully', async () => {
      const mockMessage = {
        _id: 'message-id-123',
        sender: 'user-id-123',
        group: 'group-id-456',
        content: 'Group message',
        type: 'text',
        save: jest.fn().mockResolvedValue(true),
        populate: jest.fn().mockResolvedValue({
          _id: 'message-id-123',
          sender: { username: 'testuser', avatar: '' },
          group: 'group-id-456',
          content: 'Group message',
          type: 'text',
        }),
      };

      (Message as any).mockImplementation(() => mockMessage);

      await messageHandlers['send-group-message']({
        groupId: 'group-id-456',
        content: 'Group message',
        type: 'text',
      });

      expect(Message).toHaveBeenCalledWith({
        sender: 'user-id-123',
        group: 'group-id-456',
        content: 'Group message',
        type: 'text',
        fileUrl: undefined,
        fileName: undefined,
        replyTo: undefined,
      });
      expect(mockMessage.save).toHaveBeenCalled();
      expect(mockTo).toHaveBeenCalledWith('group:group-id-456');
      expect(mockEmit).toHaveBeenCalledWith('receive-group-message', expect.any(Object));
    });

    it('should handle group message send error', async () => {
      (Message as any).mockImplementation(() => {
        throw new Error('Database error');
      });

      await messageHandlers['send-group-message']({
        groupId: 'group-id-456',
        content: 'Group message',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        message: 'Failed to send group message',
      });
    });
  });

  describe('Edit Message Handler', () => {
    let connectionCallback: Function;
    let messageHandlers: { [key: string]: Function };

    beforeEach(async () => {
      const mockUser = {
        _id: { toString: () => 'user-id-123' },
        username: 'testuser',
      };

      (jwt.verify as jest.Mock).mockReturnValue({ userId: 'user-id-123' });
      (User.findById as jest.Mock).mockResolvedValue(mockUser);
      (User.findByIdAndUpdate as jest.Mock).mockResolvedValue(mockUser);
      (Group.find as jest.Mock).mockResolvedValue([]);

      setupSocketIO(mockIo as Server);

      const middleware = (mockIo as any)._middleware;
      await middleware(mockSocket as Socket, jest.fn());

      connectionCallback = (mockIo as any)._connectionCallback;
      await connectionCallback(mockSocket as Socket);

      messageHandlers = {};
      mockOn.mock.calls.forEach(([event, handler]) => {
        if (event !== 'connection') {
          messageHandlers[event] = handler;
        }
      });
    });

    it('should edit message successfully', async () => {
      const mockMessage: any = {
        _id: 'message-id-123',
        sender: { toString: () => 'user-id-123' },
        receiver: 'receiver-id-456',
        content: 'Original message',
        edited: false,
        editedAt: undefined,
        save: jest.fn().mockResolvedValue(true),
        populate: jest.fn().mockResolvedValue({
          _id: 'message-id-123',
          sender: { username: 'testuser', avatar: '' },
          receiver: 'receiver-id-456',
          content: 'Edited message',
          edited: true,
          editedAt: expect.any(Date),
        }),
      };

      (Message.findById as jest.Mock).mockResolvedValue(mockMessage);

      await messageHandlers['edit-message']({
        messageId: 'message-id-123',
        content: 'Edited message',
      });

      expect(Message.findById).toHaveBeenCalledWith('message-id-123');
      expect(mockMessage.content).toBe('Edited message');
      expect(mockMessage.edited).toBe(true);
      expect(mockMessage.editedAt).toBeInstanceOf(Date);
      expect(mockMessage.save).toHaveBeenCalled();
      expect(mockTo).toHaveBeenCalledWith('user:receiver-id-456');
      expect(mockEmit).toHaveBeenCalledWith('message-edited', expect.any(Object));
    });

    it('should not allow editing message from another user', async () => {
      const mockMessage: any = {
        _id: 'message-id-123',
        sender: { toString: () => 'other-user-id' },
        receiver: 'receiver-id-456',
        content: 'Original message',
        save: jest.fn(),
      };

      (Message.findById as jest.Mock).mockResolvedValue(mockMessage);

      await messageHandlers['edit-message']({
        messageId: 'message-id-123',
        content: 'Edited message',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        message: 'You can only edit your own messages',
      });
      expect(mockMessage.save).not.toHaveBeenCalled();
    });

    it('should not allow editing deleted message', async () => {
      const mockMessage: any = {
        _id: 'message-id-123',
        sender: { toString: () => 'user-id-123' },
        receiver: 'receiver-id-456',
        content: 'Original message',
        deleted: true,
        save: jest.fn(),
      };

      (Message.findById as jest.Mock).mockResolvedValue(mockMessage);

      await messageHandlers['edit-message']({
        messageId: 'message-id-123',
        content: 'Edited message',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        message: 'Cannot edit deleted message',
      });
    });

    it('should handle message not found', async () => {
      (Message.findById as jest.Mock).mockResolvedValue(null);

      await messageHandlers['edit-message']({
        messageId: 'non-existent-id',
        content: 'Edited message',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        message: 'Message not found',
      });
    });

    it('should edit group message', async () => {
      const mockMessage: any = {
        _id: 'message-id-123',
        sender: { toString: () => 'user-id-123' },
        group: 'group-id-456',
        content: 'Original message',
        edited: false,
        editedAt: undefined,
        save: jest.fn().mockResolvedValue(true),
        populate: jest.fn().mockResolvedValue({
          _id: 'message-id-123',
          sender: { username: 'testuser', avatar: '' },
          group: 'group-id-456',
          content: 'Edited message',
          edited: true,
        }),
      };

      (Message.findById as jest.Mock).mockResolvedValue(mockMessage);

      await messageHandlers['edit-message']({
        messageId: 'message-id-123',
        content: 'Edited message',
      });

      expect(mockTo).toHaveBeenCalledWith('group:group-id-456');
      expect(mockEmit).toHaveBeenCalledWith('message-edited', expect.any(Object));
    });
  });

  describe('Delete Message Handler', () => {
    let connectionCallback: Function;
    let messageHandlers: { [key: string]: Function };

    beforeEach(async () => {
      const mockUser = {
        _id: { toString: () => 'user-id-123' },
        username: 'testuser',
      };

      (jwt.verify as jest.Mock).mockReturnValue({ userId: 'user-id-123' });
      (User.findById as jest.Mock).mockResolvedValue(mockUser);
      (User.findByIdAndUpdate as jest.Mock).mockResolvedValue(mockUser);
      (Group.find as jest.Mock).mockResolvedValue([]);

      setupSocketIO(mockIo as Server);

      const middleware = (mockIo as any)._middleware;
      await middleware(mockSocket as Socket, jest.fn());

      connectionCallback = (mockIo as any)._connectionCallback;
      await connectionCallback(mockSocket as Socket);

      messageHandlers = {};
      mockOn.mock.calls.forEach(([event, handler]) => {
        if (event !== 'connection') {
          messageHandlers[event] = handler;
        }
      });
    });

    it('should delete message successfully', async () => {
      const mockMessage: any = {
        _id: 'message-id-123',
        sender: { toString: () => 'user-id-123' },
        receiver: 'receiver-id-456',
        content: 'Original message',
        deleted: false,
        deletedAt: undefined,
        save: jest.fn().mockResolvedValue(true),
        populate: jest.fn().mockResolvedValue({
          _id: 'message-id-123',
          sender: { username: 'testuser', avatar: '' },
          receiver: 'receiver-id-456',
          content: 'This message was deleted',
          deleted: true,
          deletedAt: expect.any(Date),
        }),
      };

      (Message.findById as jest.Mock).mockResolvedValue(mockMessage);

      await messageHandlers['delete-message']({
        messageId: 'message-id-123',
      });

      expect(Message.findById).toHaveBeenCalledWith('message-id-123');
      expect(mockMessage.deleted).toBe(true);
      expect(mockMessage.deletedAt).toBeInstanceOf(Date);
      expect(mockMessage.content).toBe('This message was deleted');
      expect(mockMessage.save).toHaveBeenCalled();
      expect(mockTo).toHaveBeenCalledWith('user:receiver-id-456');
      expect(mockEmit).toHaveBeenCalledWith('message-deleted', expect.any(Object));
    });

    it('should not allow deleting message from another user', async () => {
      const mockMessage = {
        _id: 'message-id-123',
        sender: { toString: () => 'other-user-id' },
        receiver: 'receiver-id-456',
        content: 'Original message',
      };

      (Message.findById as jest.Mock).mockResolvedValue(mockMessage);

      await messageHandlers['delete-message']({
        messageId: 'message-id-123',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        message: 'You can only delete your own messages',
      });
    });

    it('should handle message not found', async () => {
      (Message.findById as jest.Mock).mockResolvedValue(null);

      await messageHandlers['delete-message']({
        messageId: 'non-existent-id',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        message: 'Message not found',
      });
    });
  });

  describe('Typing Indicator Handler', () => {
    let connectionCallback: Function;
    let messageHandlers: { [key: string]: Function };

    beforeEach(async () => {
      const mockUser = {
        _id: { toString: () => 'user-id-123' },
        username: 'testuser',
      };

      (jwt.verify as jest.Mock).mockReturnValue({ userId: 'user-id-123' });
      (User.findById as jest.Mock).mockResolvedValue(mockUser);
      (User.findByIdAndUpdate as jest.Mock).mockResolvedValue(mockUser);
      (Group.find as jest.Mock).mockResolvedValue([]);

      setupSocketIO(mockIo as Server);

      const middleware = (mockIo as any)._middleware;
      await middleware(mockSocket as Socket, jest.fn());

      connectionCallback = (mockIo as any)._connectionCallback;
      await connectionCallback(mockSocket as Socket);

      messageHandlers = {};
      mockOn.mock.calls.forEach(([event, handler]) => {
        if (event !== 'connection') {
          messageHandlers[event] = handler;
        }
      });
    });

    it('should emit typing indicator', () => {
      messageHandlers['typing']({
        receiverId: 'receiver-id-456',
        isTyping: true,
      });

      expect(mockTo).toHaveBeenCalledWith('user:receiver-id-456');
      expect(mockEmit).toHaveBeenCalledWith('user-typing', {
        userId: 'user-id-123',
        username: 'testuser',
        isTyping: true,
      });
    });

    it('should emit group typing indicator', () => {
      messageHandlers['group-typing']({
        groupId: 'group-id-456',
        isTyping: true,
      });

      expect(mockTo).toHaveBeenCalledWith('group:group-id-456');
      expect(mockEmit).toHaveBeenCalledWith('user-group-typing', {
        userId: 'user-id-123',
        username: 'testuser',
        isTyping: true,
      });
    });
  });

  describe('Disconnect Handler', () => {
    let connectionCallback: Function;
    let disconnectHandler: Function;

    beforeEach(async () => {
      const mockUser = {
        _id: { toString: () => 'user-id-123' },
        username: 'testuser',
      };

      (jwt.verify as jest.Mock).mockReturnValue({ userId: 'user-id-123' });
      (User.findById as jest.Mock).mockResolvedValue(mockUser);
      (User.findByIdAndUpdate as jest.Mock).mockResolvedValue(mockUser);
      (Group.find as jest.Mock).mockResolvedValue([]);

      setupSocketIO(mockIo as Server);

      const middleware = (mockIo as any)._middleware;
      await middleware(mockSocket as Socket, jest.fn());

      connectionCallback = (mockIo as any)._connectionCallback;
      await connectionCallback(mockSocket as Socket);

      // Find disconnect handler
      const disconnectCall = mockOn.mock.calls.find(([event]) => event === 'disconnect');
      disconnectHandler = disconnectCall?.[1];
    });

    it('should handle user disconnect', async () => {
      await disconnectHandler();

      expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
        'user-id-123',
        {
          isOnline: false,
          lastSeen: expect.any(Date),
        }
      );
      expect(mockBroadcastEmit).toHaveBeenCalledWith('user-offline', {
        userId: 'user-id-123',
        username: 'testuser',
      });
    });
  });
});
