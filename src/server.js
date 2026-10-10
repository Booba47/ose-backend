import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

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

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('combined'));

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

// CONNEXION DES ROUTES DE L'API
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
    path: req.originalUrl,
  });
});

// GESTION DES ERREURS
app.use((err, req, res, next) => {
  console.error('Erreur serveur :', err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
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
