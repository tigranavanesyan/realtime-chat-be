// Jest setup file
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Set test environment variables
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';
process.env.NODE_ENV = 'test';
