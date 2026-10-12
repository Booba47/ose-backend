import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { isValidUuid } from '../utils/validation.js';

const router = Router();

async function isBlocked(userId, otherUserId) {
  const { data, error } = await supabaseAdmin
    .from('blocks')
    .select('id')
    .or(
      `and(user_id.eq.${userId},blocked_user_id.eq.${otherUserId}),and(user_id.eq.${otherUserId},blocked_user_id.eq.${userId})`,
    )
    .limit(1);

  if (error) {
    console.error('Erreur vérification blocage :', error);
    throw new Error('BLOCK_CHECK_FAILED');
  }

  return (data ?? []).length > 0;
}

// AIMER UN UTILISATEUR
router.post('/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;

    if (!isValidUuid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Identifiant utilisateur invalide.',
      });
    }

    if (userId === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'Tu ne peux pas aimer ton propre profil.',
      });
    }

    const { data: profile, error: profileError } =
      await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .maybeSingle();

    if (profileError) {
      console.error('Erreur recherche profil :', profileError);

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

    if (await isBlocked(req.user.id, userId)) {
      return res.status(403).json({
        success: false,
        message: 'Cette action est impossible.',
      });
    }

    // Retirer un éventuel passage précédent.
    const { error: passError } = await supabaseAdmin
      .from('passes')
      .delete()
      .eq('user_id', req.user.id)
      .eq('passed_user_id', userId);

    if (passError) {
      console.error('Erreur suppression passage :', passError);

      return res.status(500).json({
        success: false,
        message: 'Impossible d’enregistrer ton choix.',
      });
    }

    // Enregistrer le like.
    const { error: likeError } = await supabaseAdmin
      .from('likes')
      .upsert(
        {
          user_id: req.user.id,
          liked_user_id: userId,
        },
        {
          onConflict: 'user_id,liked_user_id',
          ignoreDuplicates: true,
        },
      );

    if (likeError) {
      console.error('Erreur création like :', likeError);

      return res.status(500).json({
        success: false,
        message: 'Impossible d’enregistrer ton like.',
      });
    }

    // Vérifier si l’autre utilisateur nous a déjà aimés.
    const { data: reciprocalLike, error: reciprocalError } =
      await supabaseAdmin
        .from('likes')
        .select('id')
        .eq('user_id', userId)
        .eq('liked_user_id', req.user.id)
        .maybeSingle();

    if (reciprocalError) {
      console.error('Erreur vérification like réciproque :', reciprocalError);

      return res.status(500).json({
        success: false,
        message: 'Like enregistré, mais impossible de vérifier le match.',
      });
    }

    if (!reciprocalLike) {
      return res.json({
        success: true,
        matched: false,
        message: 'Like enregistré.',
      });
    }

    // Créer ou récupérer le match avec un ordre canonique des utilisateurs.
    const [userOneId, userTwoId] = [req.user.id, userId].sort();

    const { data: match, error: matchError } = await supabaseAdmin
      .from('matches')
      .upsert(
        {
          user_one_id: userOneId,
          user_two_id: userTwoId,
        },
        {
          onConflict: 'user_one_id,user_two_id',
          ignoreDuplicates: true,
        },
      )
      .select('id, user_one_id, user_two_id')
      .maybeSingle();

    if (matchError) {
      console.error('Erreur création match :', matchError);

      return res.status(500).json({
        success: false,
        message: 'Likes enregistrés, mais impossible de créer le match.',
      });
    }

    let finalMatch = match;

    // En cas de doublon ignoré par upsert, récupérer le match existant.
    if (!finalMatch) {
      const { data: existingMatch, error: existingMatchError } =
        await supabaseAdmin
          .from('matches')
          .select('id, user_one_id, user_two_id')
          .eq('user_one_id', userOneId)
          .eq('user_two_id', userTwoId)
          .maybeSingle();

      if (existingMatchError || !existingMatch) {
        console.error(
          'Erreur récupération match existant :',
          existingMatchError,
        );

        return res.status(500).json({
          success: false,
          message: 'Impossible de récupérer le match.',
        });
      }

      finalMatch = existingMatch;
    }

    // Créer ou récupérer la conversation associée au match.
    const { data: conversation, error: conversationError } =
      await supabaseAdmin
        .from('conversations')
        .upsert(
          {
            match_id: finalMatch.id,
          },
          {
            onConflict: 'match_id',
            ignoreDuplicates: true,
          },
        )
        .select('id, match_id')
        .maybeSingle();

    if (conversationError) {
      console.error('Erreur création conversation :', conversationError);

      return res.status(500).json({
        success: false,
        matched: true,
        match: finalMatch,
        message: 'Match créé, mais impossible de créer la conversation.',
      });
    }

    let finalConversation = conversation;

    if (!finalConversation) {
      const { data: existingConversation, error: existingConversationError } =
        await supabaseAdmin
          .from('conversations')
          .select('id, match_id')
          .eq('match_id', finalMatch.id)
          .maybeSingle();

      if (existingConversationError || !existingConversation) {
        console.error(
          'Erreur récupération conversation :',
          existingConversationError,
        );

        return res.status(500).json({
          success: false,
          matched: true,
          match: finalMatch,
          message: 'Match créé, mais impossible de récupérer la conversation.',
        });
      }

      finalConversation = existingConversation;
    }

    return res.json({
      success: true,
      matched: true,
      message: 'C’est un match !',
      match: finalMatch,
      conversation: finalConversation,
    });
  } catch (error) {
    console.error('Erreur route like :', error);

    if (error.message === 'BLOCK_CHECK_FAILED') {
      return res.status(500).json({
        success: false,
        message: 'Impossible de vérifier les blocages.',
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

// PASSER UN PROFIL
router.post('/:userId/pass', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;

    if (!isValidUuid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Identifiant utilisateur invalide.',
      });
    }

    if (userId === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'Action impossible sur ton propre profil.',
      });
    }

    if (await isBlocked(req.user.id, userId)) {
      return res.status(403).json({
        success: false,
        message: 'Cette action est impossible.',
      });
    }

    const { error: likeError } = await supabaseAdmin
      .from('likes')
      .delete()
      .eq('user_id', req.user.id)
      .eq('liked_user_id', userId);

    if (likeError) {
      console.error('Erreur suppression like :', likeError);

      return res.status(500).json({
        success: false,
        message: 'Impossible d’enregistrer ton choix.',
      });
    }

    const { error: passError } = await supabaseAdmin
      .from('passes')
      .upsert(
        {
          user_id: req.user.id,
          passed_user_id: userId,
        },
        {
          onConflict: 'user_id,passed_user_id',
          ignoreDuplicates: true,
        },
      );

    if (passError) {
      console.error('Erreur création passage :', passError);

      return res.status(500).json({
        success: false,
        message: 'Impossible d’enregistrer ton passage.',
      });
    }

    return res.json({
      success: true,
      message: 'Profil passé.',
    });
  } catch (error) {
    console.error('Erreur route pass :', error);

    if (error.message === 'BLOCK_CHECK_FAILED') {
      return res.status(500).json({
        success: false,
        message: 'Impossible de vérifier les blocages.',
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

// CONSULTER LES LIKES ENVOYÉS
router.get('/mine/list', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('likes')
      .select('id, liked_user_id, created_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      console.error('Erreur liste likes :', error);

      return res.status(500).json({
        success: false,
        message: 'Impossible de récupérer tes likes.',
      });
    }

    const likes = data ?? [];
    const userIds = likes.map((like) => like.liked_user_id);

    if (userIds.length === 0) {
      return res.json({
        success: true,
        likes: [],
      });
    }

    const { data: blockedRows, error: blockedError } = await supabaseAdmin
      .from('blocks')
      .select('user_id, blocked_user_id')
      .or(
        `user_id.eq.${req.user.id},blocked_user_id.eq.${req.user.id}`,
      );

    if (blockedError) {
      console.error('Erreur filtrage likes bloqués :', blockedError);

      return res.status(500).json({
        success: false,
        message: 'Impossible de récupérer tes likes.',
      });
    }

    const blockedIds = new Set();

    for (const block of blockedRows ?? []) {
      if (block.user_id === req.user.id) {
        blockedIds.add(block.blocked_user_id);
      } else {
        blockedIds.add(block.user_id);
      }
    }

    return res.json({
      success: true,
      likes: likes.filter((like) => !blockedIds.has(like.liked_user_id)),
    });
  } catch (error) {
    console.error('Erreur liste likes :', error);

    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

// RETIRER UN LIKE ENVOYÉ
router.delete('/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;

    if (!isValidUuid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Identifiant utilisateur invalide.',
      });
    }

    const { error } = await supabaseAdmin
      .from('likes')
      .delete()
      .eq('user_id', req.user.id)
      .eq('liked_user_id', userId);

    if (error) {
      console.error('Erreur suppression like :', error);

      return res.status(500).json({
        success: false,
        message: 'Impossible de retirer ce like.',
      });
    }

    return res.json({
      success: true,
      message: 'Like retiré.',
    });
  } catch (error) {
    console.error('Erreur suppression like :', error);

    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

export default router;
