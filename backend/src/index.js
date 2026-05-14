import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import scanRoutes from './routes/scan.js';
import subscriptionRoutes from './routes/subscriptions.js';

dotenv.config();

const app = express();

app.use(helmet());
app.use(express.json());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

app.use('/auth', authRoutes);
app.use('/scan', scanRoutes);
app.use('/subscriptions', subscriptionRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`SubZero backend running on port ${PORT}`));
