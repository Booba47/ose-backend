import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { rateLimit } from 'express-rate-limit';

import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import photosRoutes from './routes/photos.js';
import discoveryRoutes from './routes/discovery.js';
import likesRoutes from './routes/likes.js';
import matchesRoutes from './routes/matches.js';
import messagesRoutes from './routes/messages.js';
import notificationsRoutes from './routes/notifications.js';
import blocksRoutes from './routes/blocks.js';
import reportsRoutes from './routes/reports.js';

const app = express();

app.disable('x-powered-by');

app.set('trust proxy', 1);

app.use(helmet());

app.use(
  cors({
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim())
      : false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);

app.use(express.json({ limit: '100kb' }));

app.use(morgan('combined'));

// LIMITE GÉNÉRALE DES REQUÊTES
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Trop de requêtes. Réessaie dans quelques minutes.',
  },
});

app.use(generalLimiter);

// LIMITE RENFORCÉE POUR L'AUTHENTIFICATION
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Trop de tentatives. Réessaie dans 15 minutes.',
  },
});

app.use('/api/auth', authLimiter);

// ROUTE D'ACCUEIL
app.get('/', (req, res) => {
  res.json({
    success: true,
    name: 'Ose Backend',
    message: 'Bienvenue sur l’API de Ose.',
    version: '1.0.0',
  });
});

// VÉRIFICATION DE L'ÉTAT DU SERVEUR
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    status: 'healthy',
    service: 'ose-backend',
    timestamp: new Date().toISOString(),
  });
});

// ROUTES DE L'API
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/photos', photosRoutes);
app.use('/api/discovery', discoveryRoutes);
app.use('/api/likes', likesRoutes);
app.use('/api/matches', matchesRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/blocks', blocksRoutes);
app.use('/api/reports', reportsRoutes);

// ROUTE INTROUVABLE
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route introuvable.',
  });
});

// GESTION DES ERREURS
app.use((err, req, res, next) => {
  console.error('Erreur serveur :', err);

  if (res.headersSent) {
    return next(err);
  }

  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      message: 'La requête est trop volumineuse.',
    });
  }

  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      message: 'Le JSON envoyé est invalide.',
    });
  }

  return res.status(500).json({
    success: false,
    message: 'Une erreur interne est survenue.',
  });
});

// DÉMARRAGE DU SERVEUR
const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Ose Backend démarré sur le port ${PORT}`);
});

export default app; 
