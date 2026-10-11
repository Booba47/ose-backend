
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

const BUCKET = 'ose-photos';

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

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'Profil introuvable. Termine d’abord ton inscription.',
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
      if (
        typeof body.name !== 'string' ||
        !isNonEmptyString(body.name) ||
        cleanString(body.name).length > 80
      ) {
        return res.status(400).json({
          success: false,
          message: 'Le prénom est obligatoire et limité à 80 caractères.',
        });
      }

      updates.name = cleanString(body.name);
    }

    if ('birthDate' in body) {
      if (
        !isValidDate(body.birthDate) ||
        !isAdult(body.birthDate)
      ) {
        return res.status(400).json({
          success: false,
          message: 'La date de naissance doit correspondre à une personne majeure.',
        });
      }

      updates.birth_date = cleanString(body.birthDate);
    }

    if ('city' in body) {
      if (
        typeof body.city !== 'string' ||
        cleanString(body.city).length > 120
      ) {
        return res.status(400).json({
          success: false,
          message: 'La ville est invalide ou trop longue.',
        });
      }

      updates.city = cleanString(body.city);
    }

    if ('bio' in body) {
      if (
        typeof body.bio !== 'string' ||
        body.bio.trim().length > 1000
      ) {
        return res.status(400).json({
          success: false,
          message: 'La description doit contenir au maximum 1000 caractères.',
        });
      }

      updates.bio = cleanString(body.bio);
    }

    if ('lookingFor' in body) {
      if (
        typeof body.lookingFor !== 'string' ||
        cleanString(body.lookingFor).length > 120
      ) {
        return res.status(400).json({
          success: false,
          message: 'La préférence de rencontre est invalide ou trop longue.',
        });
      }

      updates.looking_for = cleanString(body.lookingFor);
    }

    if ('interests' in body) {
      if (
        !Array.isArray(body.interests) ||
        body.interests.some((item) => typeof item !== 'string')
      ) {
        return res.status(400).json({
          success: false,
          message: 'La liste des centres d’intérêt est invalide.',
        });
      }

      updates.interests = cleanStringArray(body.interests)
        .filter(Boolean)
        .slice(0, 30);
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

// SUPPRIMER MON COMPTE ET SES PHOTOS
router.delete('/me', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    // Récupérer les chemins des photos appartenant au compte.
    const { data: photos, error: photosError } = await supabaseAdmin
      .from('photos')
      .select('storage_path')
      .eq('user_id', userId);

    if (photosError) {
      console.error('Erreur lecture photos avant suppression :', photosError);
      return res.status(500).json({
        success: false,
        message: 'Impossible de préparer la suppression des photos.',
      });
    }

    const paths = (photos ?? [])
      .map((photo) => photo.storage_path)
      .filter(
        (path) =>
          typeof path === 'string' &&
          path.startsWith(`${userId}/`),
      );

    // Supabase Storage accepte plusieurs chemins par demande.
    // Utiliser des lots pour éviter une requête trop volumineuse.
    for (let index = 0; index < paths.length; index += 100) {
      const batch = paths.slice(index, index + 100);

      const { error: storageError } = await supabaseAdmin.storage
        .from(BUCKET)
        .remove(batch);

      if (storageError) {
        console.error('Erreur suppression photos Storage :', storageError);
        return res.status(500).json({
          success: false,
          message: 'Les photos n’ont pas toutes pu être supprimées. Le compte est conservé pour permettre une nouvelle tentative.',
        });
      }
    }

    // Supprimer le compte Auth.
    // Les clés étrangères ON DELETE CASCADE suppriment les données
    // associées dans les tables de la base.
    const { error: deleteError } = await supabaseAdmin.auth.admin
      .deleteUser(userId);

    if (deleteError) {
      console.error('Erreur suppression compte :', deleteError);
      return res.status(500).json({
        success: false,
        message: 'Les photos ont été traitées, mais la suppression du compte a échoué. Contacte le support si nécessaire.',
      });
    }

    return res.json({
      success: true,
      message: 'Compte et données associées supprimés.',
    });
  } catch (error) {
    console.error('Erreur suppression compte :', error);

    return res.status(500).json({
      success: false,
      message: 'Erreur interne pendant la suppression du compte.',
    });
  }
});

export default router;
 
