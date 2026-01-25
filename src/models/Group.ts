import mongoose, { Document, Schema } from 'mongoose';

export interface IGroup extends Document {
  name: string;
  description?: string;
  creator: mongoose.Types.ObjectId;
  members: mongoose.Types.ObjectId[];
  avatar?: string;
}

const groupSchema = new Schema<IGroup>({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  creator: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  members: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  avatar: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

export default mongoose.model<IGroup>('Group', groupSchema);
