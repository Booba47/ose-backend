import { supabase } from '../config/supabase.js';

export async function requireAuth(req, res, next) {
  try {
    const authorization = req.headers.authorization;

    if (!authorization) {
      return res.status(401).json({
        success: false,
        message: 'Authentification requise.',
      });
    }

    if (!authorization.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Token d’authentification invalide.',
      });
    }

    const token = authorization.substring(7).trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token d’authentification manquant.',
      });
    }

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({
        success: false,
        message: 'Session invalide ou expirée.',
      });
    }

    req.user = user;
    req.accessToken = token;

    next();
  } catch (error) {
    console.error('Erreur middleware auth:', error);

    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la vérification de l’authentification.',
    });
  }
          }
