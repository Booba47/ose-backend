import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import {
  cleanString,
  isNonEmptyString,
  isValidUuid,
} from '../utils/validation.js';

const router = Router();

const ALLOWED_REASONS = [
  'harassment',
  'inappropriate_photos',
  'fake_profile',
  'spam',
  'underage',
  'other',
];

// SIGNALER UN UTILISATEUR
router.post('/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const reason = cleanString(req.body?.reason);
    const details = cleanString(req.body?.details);

    if (!isValidUuid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Identifiant utilisateur invalide.',
      });
    }

    if (userId === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'Tu ne peux pas signaler ton propre profil.',
      });
    }

    if (!ALLOWED_REASONS.includes(reason)) {
      return res.status(400).json({
        success: false,
        message: 'Motif de signalement invalide.',
        allowedReasons: ALLOWED_REASONS,
      });
    }

    if (details.length > 2000) {
      return res.status(400).json({
        success: false,
        message: 'Les détails ne doivent pas dépasser 2000 caractères.',
      });
    }

    const { data: profile, error: profileError } =
      await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .maybeSingle();

    if (profileError) {
      console.error('Erreur recherche profil signalé :', profileError);

      return res.status(500).json({
        success: false,
        message: 'Impossible de vérifier ce profil.',
      });
    }

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur introuvable.',
      });
    }

    const fullReason = details
      ? `${reason}: ${details}`
      : reason;

    const { data: report, error } = await supabaseAdmin
      .from('reports')
      .insert({
        reporter_id: req.user.id,
        reported_user_id: userId,
        reason: fullReason,
      })
      .select('id, reported_user_id, reason, created_at')
      .single();

    if (error) {
      console.error('Erreur création signalement :', error);

      return res.status(500).json({
        success: false,
        message: 'Impossible d’envoyer le signalement.',
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Signalement envoyé. Merci de nous aider à protéger la communauté.',
      report,
    });
  } catch (error) {
    console.error('Erreur route signalement :', error);

    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

export default router;
