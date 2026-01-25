import mongoose, { Document, Schema } from 'mongoose';

export interface IMessage extends Document {
  sender: mongoose.Types.ObjectId;
  receiver?: mongoose.Types.ObjectId;
  group?: mongoose.Types.ObjectId;
  content: string;
  type: 'text' | 'file' | 'image';
  fileUrl?: string;
  fileName?: string;
  read: boolean;
  readAt?: Date;
}

const messageSchema = new Schema<IMessage>({
  sender: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  receiver: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  group: {
    type: Schema.Types.ObjectId,
    ref: 'Group'
  },
  content: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['text', 'file', 'image'],
    default: 'text'
  },
  fileUrl: String,
  fileName: String,
  read: {
    type: Boolean,
    default: false
  },
  readAt: Date
}, {
  timestamps: true
});

export default mongoose.model<IMessage>('Message', messageSchema);
