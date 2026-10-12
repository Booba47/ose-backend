
import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { isValidUUID } from '../utils/validation.js';

const router = Router();

async function isBlocked(userId, profileId) {
  const { data, error } = await supabaseAdmin
    .from('blocks')
    .select('id')
    .or(
      `and(user_id.eq.${userId},blocked_user_id.eq.${profileId}),and(user_id.eq.${profileId},blocked_user_id.eq.${userId})`,
    )
    .limit(1);

  if (error) {
    console.error('Erreur vérification blocage :', error);
    throw new Error('BLOCK_CHECK_FAILED');
  }

  return (data ?? []).length > 0;
}

async function getTargetProfile(profileId, res) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('id', profileId)
    .maybeSingle();

  if (error) {
    console.error('Erreur vérification profil :', error);
    res.status(500).json({
      success: false,
      message: 'Impossible de vérifier ce profil.',
    });
    return null;
  }

  if (!data) {
    res.status(404).json({
      success: false,
      message: 'Profil introuvable.',
    });
    return null;
  }

  return data;
}

// ENREGISTRER UN LIKE
router.post('/:profileId', requireAuth, async (req, res) => {
  try {
    const profileId = req.params.profileId;

    if (!isValidUUID(profileId)) {
      return res.status(400).json({
        success: false,
        message: 'Identifiant de profil invalide.',
      });
    }

    if (profileId === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'Tu ne peux pas aimer ton propre profil.',
      });
    }

    const target = await getTargetProfile(profileId, res);
    if (!target) return;

    if (await isBlocked(req.user.id, profileId)) {
      return res.status(403).json({
        success: false,
        message: 'Cette interaction n’est pas autorisée.',
      });
    }

    // Retirer un éventuel pass précédent.
    const { error: passError } = await supabaseAdmin
      .from('passes')
      .delete()
      .eq('user_id', req.user.id)
      .eq('passed_user_id', profileId);

    if (passError) {
      console.error('Erreur suppression pass :', passError);
      return res.status(500).json({
        success: false,
        message: 'Impossible d’enregistrer ce like.',
      });
    }

    // Enregistrer le like sans créer de doublon.
    const { error: likeError } = await supabaseAdmin
      .from('likes')
      .upsert(
        {
          user_id: req.user.id,
          liked_user_id: profileId,
        },
        { onConflict: 'user_id,liked_user_id' },
      );

    if (likeError) {
      console.error('Erreur enregistrement like :', likeError);
      return res.status(500).json({
        success: false,
        message: 'Impossible d’enregistrer ce like.',
      });
    }

    // Vérifier le like réciproque.
    const { data: reciprocalLike, error: reciprocalError } =
      await supabaseAdmin
        .from('likes')
        .select('id')
        .eq('user_id', profileId)
        .eq('liked_user_id', req.user.id)
        .maybeSingle();

    if (reciprocalError) {
      console.error('Erreur vérification match :', reciprocalError);
      return res.status(500).json({
        success: false,
        message: 'Like enregistré, mais vérification du match impossible.',
      });
    }

    let match = null;

    if (reciprocalLike) {
      const [firstUser, secondUser] = [
        req.user.id,
        profileId,
      ].sort();

      const { data: createdMatch, error: matchError } =
        await supabaseAdmin
          .from('matches')
          .upsert(
            {
              user_one_id: firstUser,
              user_two_id: secondUser,
            },
            { onConflict: 'user_one_id,user_two_id' },
          )
          .select('id, user_one_id, user_two_id, created_at')
          .single();

      if (matchError) {
        console.error('Erreur création match :', matchError);
        return res.status(500).json({
          success: false,
          message: 'Like enregistré, mais création du match impossible.',
        });
      }

      match = createdMatch;

      // Une seule conversation par match.
      const { error: conversationError } = await supabaseAdmin
        .from('conversations')
        .upsert(
          { match_id: match.id },
          { onConflict: 'match_id', ignoreDuplicates: true },
        );

      if (conversationError) {
        console.error(
          'Erreur création conversation :',
          conversationError,
        );

        return res.status(500).json({
          success: false,
          message: 'Match créé, mais création de la conversation impossible.',
          isMatch: true,
          match,
        });
      }
    }

    return res.json({
      success: true,
      message: match ? 'C’est un match !' : 'Like enregistré.',
      liked: true,
      isMatch: Boolean(match),
      match,
    });
  } catch (error) {
    if (error.message === 'BLOCK_CHECK_FAILED') {
      return res.status(500).json({
        success: false,
        message: 'Impossible de vérifier les blocages.',
      });
    }

    console.error('Erreur route like :', error);

    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

// PASSER UN PROFIL
router.post('/:profileId/pass', requireAuth, async (req, res) => {
  try {
    const profileId = req.params.profileId;

    if (!isValidUUID(profileId)) {
      return res.status(400).json({
        success: false,
        message: 'Identifiant de profil invalide.',
      });
    }

    if (profileId === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'Action impossible sur ton propre profil.',
      });
    }

    const target = await getTargetProfile(profileId, res);
    if (!target) return;

    if (await isBlocked(req.user.id, profileId)) {
      return res.status(403).json({
        success: false,
        message: 'Cette interaction n’est pas autorisée.',
      });
    }

    const { error: likeError } = await supabaseAdmin
      .from('likes')
      .delete()
      .eq('user_id', req.user.id)
      .eq('liked_user_id', profileId);

    if (likeError) {
      console.error('Erreur retrait like avant pass :', likeError);
      return res.status(500).json({
        success: false,
        message: 'Impossible d’enregistrer ce choix.',
      });
    }

    const { error: passError } = await supabaseAdmin
      .from('passes')
      .upsert(
        {
          user_id: req.user.id,
          passed_user_id: profileId,
        },
        { onConflict: 'user_id,passed_user_id' },
      );

    if (passError) {
      console.error('Erreur enregistrement pass :', passError);
      return res.status(500).json({
        success: false,
        message: 'Impossible d’enregistrer ce choix.',
      });
    }

    return res.json({
      success: true,
      message: 'Profil ignoré.',
      passed: true,
    });
  } catch (error) {
    if (error.message === 'BLOCK_CHECK_FAILED') {
      return res.status(500).json({
        success: false,
        message: 'Impossible de vérifier les blocages.',
      });
    }

    console.error('Erreur route pass :', error);

    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

// CONSULTER MES LIKES
router.get('/mine/list', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('likes')
      .select('liked_user_id, created_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erreur lecture likes :', error);
      return res.status(500).json({
        success: false,
        message: 'Impossible de récupérer tes likes.',
      });
    }

    return res.json({
      success: true,
      likes: data ?? [],
    });
  } catch (error) {
    console.error('Erreur lecture likes :', error);

    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

// RETIRER UN LIKE
router.delete('/:profileId', requireAuth, async (req, res) => {
  try {
    const profileId = req.params.profileId;

    if (!isValidUUID(profileId) || profileId === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'Identifiant de profil invalide.',
      });
    }

    const { error } = await supabaseAdmin
      .from('likes')
      .delete()
      .eq('user_id', req.user.id)
      .eq('liked_user_id', profileId);

    if (error) {
      console.error('Erreur retrait like :', error);
      return res.status(500).json({
        success: false,
        message: 'Impossible de retirer le like.',
      });
    }

    return res.json({
      success: true,
      message: 'Like retiré.',
    });
  } catch (error) {
    console.error('Erreur retrait like :', error);

    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

export default router;
 
