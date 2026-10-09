import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { isValidUuid } from '../utils/validation.js';

const router = Router();

// RÉCUPÉRER LES NOTIFICATIONS
router.get('/', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('notifications')
      .select('id, message, is_read, created_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Erreur notifications :', error);

      return res.status(500).json({
        success: false,
        message: 'Impossible de récupérer les notifications.',
      });
    }

    return res.json({
      success: true,
      notifications: data ?? [],
    });
  } catch (error) {
    console.error('Erreur route notifications :', error);

    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

// COMPTER LES NOTIFICATIONS NON LUES
router.get('/unread-count', requireAuth, async (req, res) => {
  try {
    const { count, error } = await supabaseAdmin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', req.user.id)
      .eq('is_read', false);

    if (error) {
      console.error('Erreur compteur notifications :', error);

      return res.status(500).json({
        success: false,
        message: 'Impossible de compter les notifications.',
      });
    }

    return res.json({
      success: true,
      unreadCount: count ?? 0,
    });
  } catch (error) {
    console.error('Erreur compteur notifications :', error);

    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

// MARQUER TOUTES LES NOTIFICATIONS COMME LUES
router.patch('/read-all', requireAuth, async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', req.user.id)
      .eq('is_read', false);

    if (error) {
      console.error('Erreur lecture notifications :', error);

      return res.status(500).json({
        success: false,
        message: 'Impossible de marquer les notifications comme lues.',
      });
    }

    return res.json({
      success: true,
      message: 'Toutes les notifications ont été marquées comme lues.',
    });
  } catch (error) {
    console.error('Erreur lecture notifications :', error);

    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

// MARQUER UNE NOTIFICATION COMME LUE
router.patch('/:notificationId/read', requireAuth, async (req, res) => {
  try {
    const { notificationId } = req.params;

    if (!isValidUuid(notificationId)) {
      return res.status(400).json({
        success: false,
        message: 'Identifiant de notification invalide.',
      });
    }

    const { data, error } = await supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId)
      .eq('user_id', req.user.id)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('Erreur lecture notification :', error);

      return res.status(500).json({
        success: false,
        message: 'Impossible de mettre à jour la notification.',
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'Notification introuvable.',
      });
    }

    return res.json({
      success: true,
      message: 'Notification marquée comme lue.',
    });
  } catch (error) {
    console.error('Erreur lecture notification :', error);

    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

// SUPPRIMER UNE NOTIFICATION
router.delete('/:notificationId', requireAuth, async (req, res) => {
  try {
    const { notificationId } = req.params;

    if (!isValidUuid(notificationId)) {
      return res.status(400).json({
        success: false,
        message: 'Identifiant de notification invalide.',
      });
    }

    const { data, error } = await supabaseAdmin
      .from('notifications')
      .delete()
      .eq('id', notificationId)
      .eq('user_id', req.user.id)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('Erreur suppression notification :', error);

      return res.status(500).json({
        success: false,
        message: 'Impossible de supprimer la notification.',
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'Notification introuvable.',
      });
    }

    return res.json({
      success: true,
      message: 'Notification supprimée.',
    });
  } catch (error) {
    console.error('Erreur suppression notification :', error);

    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

export default router;
