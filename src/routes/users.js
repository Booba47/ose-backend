import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import {
  cleanString,
  cleanStringArray,
  isAdult,
  isNonEmptyString,
  isValidDate,
} from '../utils/validation.js';

const router = Router();

// CONSULTER MON PROFIL
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select(
        'id, name, birth_date, city, bio, looking_for, interests, created_at, updated_at',
      )
      .eq('id', req.user.id)
      .maybeSingle();

    if (error) {
      console.error('Erreur lecture profil :', error);
      return res.status(500).json({
        success: false,
        message: 'Impossible de récupérer le profil.',
      });
    }

    return res.json({
      success: true,
      profile: data,
    });
  } catch (error) {
    console.error('Erreur profil :', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

// MODIFIER MON PROFIL
router.patch('/me', requireAuth, async (req, res) => {
  try {
    const body = req.body ?? {};
    const updates = {};

    if ('name' in body) {
      if (!isNonEmptyString(body.name)) {
        return res.status(400).json({
          success: false,
          message: 'Le prénom ne peut pas être vide.',
        });
      }
      updates.name = cleanString(body.name);
    }

    if ('birthDate' in body) {
      if (!isValidDate(body.birthDate) || !isAdult(body.birthDate)) {
        return res.status(400).json({
          success: false,
          message: 'La date de naissance doit correspondre à une personne majeure.',
        });
      }
      updates.birth_date = cleanString(body.birthDate);
    }

    if ('city' in body) {
      if (typeof body.city !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'La ville est invalide.',
        });
      }
      updates.city = cleanString(body.city);
    }

    if ('bio' in body) {
      if (typeof body.bio !== 'string' || body.bio.length > 1000) {
        return res.status(400).json({
          success: false,
          message: 'La description doit contenir au maximum 1000 caractères.',
        });
      }
      updates.bio = cleanString(body.bio);
    }

    if ('lookingFor' in body) {
      if (typeof body.lookingFor !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'La préférence de rencontre est invalide.',
        });
      }
      updates.looking_for = cleanString(body.lookingFor);
    }

    if ('interests' in body) {
      if (!Array.isArray(body.interests)) {
        return res.status(400).json({
          success: false,
          message: 'La liste des centres d’intérêt est invalide.',
        });
      }
      updates.interests = cleanStringArray(body.interests).slice(0, 30);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Aucune modification valide à enregistrer.',
      });
    }

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', req.user.id)
      .select(
        'id, name, birth_date, city, bio, looking_for, interests, created_at, updated_at',
      )
      .maybeSingle();

    if (error) {
      console.error('Erreur modification profil :', error);
      return res.status(500).json({
        success: false,
        message: 'Impossible de modifier le profil.',
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'Profil introuvable. Termine d’abord ton inscription.',
      });
    }

    return res.json({
      success: true,
      message: 'Profil mis à jour.',
      profile: data,
    });
  } catch (error) {
    console.error('Erreur modification profil :', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

// SUPPRIMER MON COMPTE
router.delete('/me', requireAuth, async (req, res) => {
  try {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(
      req.user.id,
    );

    if (error) {
      console.error('Erreur suppression compte :', error);
      return res.status(500).json({
        success: false,
        message: 'Impossible de supprimer le compte.',
      });
    }

    return res.json({
      success: true,
      message: 'Compte supprimé.',
    });
  } catch (error) {
    console.error('Erreur suppression compte :', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

export default router;
