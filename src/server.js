import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

const app = express();

app.disable('x-powered-by');

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('combined'));

app.get('/', (req, res) => {
  res.json({
    success: true,
    name: 'Ose Backend',
    message: 'Bienvenue sur l’API de Ose.',
    version: '1.0.0',
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    status: 'healthy',
    service: 'ose-backend',
    timestamp: new Date().toISOString(),
  });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route introuvable.',
    path: req.originalUrl,
  });
});

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

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Ose Backend démarré sur le port ${PORT}`);
});

export default app;
