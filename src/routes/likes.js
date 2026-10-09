import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { isNonEmptyString, isValidUuid } from '../utils/validation.js';

const router = Router();

// ENREGISTRER UN LIKE
router.post('/:profileId', requireAuth, async (req, res) => {
  try {
    const profileId = req.params.profileId;

    if (!isValidUuid(profileId)) {
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

    const { data: target, error: targetError } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('id', profileId)
      .maybeSingle();

    if (targetError || !target) {
      return res.status(404).json({
        success: false,
        message: 'Profil introuvable.',
      });
    }

    // Un profil bloqué dans un sens ou dans l'autre ne peut pas être aimé.
    const { data: blocks, error: blockError } = await supabaseAdmin
      .from('blocks')
      .select('id')
      .or(
        `and(user_id.eq.${req.user.id},blocked_user_id.eq.${profileId}),and(user_id.eq.${profileId},blocked_user_id.eq.${req.user.id})`,
      )
      .limit(1);

    if (blockError) {
      console.error('Erreur vérification blocage :', blockError);
      return res.status(500).json({
        success: false,
        message: 'Impossible de traiter ce like.',
      });
    }

    if (blocks?.length) {
      return res.status(403).json({
        success: false,
        message: 'Cette interaction n’est pas autorisée.',
      });
    }

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
      console.error('Erreur like :', likeError);
      return res.status(500).json({
        success: false,
        message: 'Impossible d’enregistrer ce like.',
      });
    }

    // Vérifier si l'autre personne nous a déjà aimés.
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
      const [firstUser, secondUser] = [req.user.id, profileId].sort();

      const { data: createdMatch, error: matchError } = await supabaseAdmin
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

      const { error: conversationError } = await supabaseAdmin
        .from('conversations')
        .upsert(
          { match_id: match.id },
          { onConflict: 'match_id' },
        );

      if (conversationError) {
        console.error('Erreur création conversation :', conversationError);
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

    if (!isValidUuid(profileId)) {
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

    const { data: target, error: targetError } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('id', profileId)
      .maybeSingle();

    if (targetError || !target) {
      return res.status(404).json({
        success: false,
        message: 'Profil introuvable.',
      });
    }

    const { error: likeError } = await supabaseAdmin
      .from('likes')
      .delete()
      .eq('user_id', req.user.id)
      .eq('liked_user_id', profileId);

    if (likeError) {
      console.error('Erreur retrait like :', likeError);
      return res.status(500).json({
        success: false,
        message: 'Impossible d’enregistrer ce choix.',
      });
    }

    const { error } = await supabaseAdmin
      .from('passes')
      .upsert(
        {
          user_id: req.user.id,
          passed_user_id: profileId,
        },
        { onConflict: 'user_id,passed_user_id' },
      );

    if (error) {
      console.error('Erreur pass :', error);
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

    if (!isValidUuid(profileId) || profileId === req.user.id) {
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
