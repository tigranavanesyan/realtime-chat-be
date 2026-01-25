import express from 'express';
import Message from '../models/Message';
import Group from '../models/Group';
import { authenticate, AuthRequest } from '../middleware/auth';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage });

// Get messages between two users
router.get('/messages/:userId', authenticate, async (req: AuthRequest, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user._id;

    const messages = await Message.find({
      $or: [
        { sender: currentUserId, receiver: userId },
        { sender: userId, receiver: currentUserId }
      ]
    })
      .populate('sender', 'username avatar')
      .sort({ createdAt: 1 });

    res.json(messages);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// Get group messages
router.get('/groups/:groupId/messages', authenticate, async (req: AuthRequest, res) => {
  try {
    const { groupId } = req.params;

    const messages = await Message.find({ group: groupId })
      .populate('sender', 'username avatar')
      .sort({ createdAt: 1 });

    res.json(messages);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// Create group
router.post('/groups', authenticate, async (req: AuthRequest, res) => {
  try {
    const { name, description, members } = req.body;

    const group = new Group({
      name,
      description,
      creator: req.user._id,
      members: [req.user._id, ...(members || [])]
    });

    await group.save();
    await group.populate('members', 'username avatar');
    await group.populate('creator', 'username avatar');

    res.status(201).json(group);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// Get user groups
router.get('/groups', authenticate, async (req: AuthRequest, res) => {
  try {
    const groups = await Group.find({
      members: req.user._id
    })
      .populate('members', 'username avatar')
      .populate('creator', 'username avatar');

    res.json(groups);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// Upload file
router.post('/upload', authenticate, upload.single('file'), async (req: AuthRequest, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({ fileUrl, fileName: req.file.originalname });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
