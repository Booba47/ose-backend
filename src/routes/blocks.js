import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { isValidUuid } from '../utils/validation.js';

const router = Router();

// BLOQUER UN UTILISATEUR
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
        message: 'Tu ne peux pas te bloquer toi-même.',
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

    const { error } = await supabaseAdmin
      .from('blocks')
      .upsert(
        {
          user_id: req.user.id,
          blocked_user_id: userId,
        },
        {
          onConflict: 'user_id,blocked_user_id',
          ignoreDuplicates: true,
        },
      );

    if (error) {
      console.error('Erreur blocage :', error);

      return res.status(500).json({
        success: false,
        message: 'Impossible de bloquer cet utilisateur.',
      });
    }

    // Retirer les likes réciproques pour éviter un nouveau match.
    const { error: likesError } = await supabaseAdmin
      .from('likes')
      .delete()
      .or(
        `and(user_id.eq.${req.user.id},liked_user_id.eq.${userId}),and(user_id.eq.${userId},liked_user_id.eq.${req.user.id})`,
      );

    if (likesError) {
      console.error('Erreur suppression likes :', likesError);
    }

    return res.json({
      success: true,
      message: 'Utilisateur bloqué.',
    });
  } catch (error) {
    console.error('Erreur route blocage :', error);

    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

// CONSULTER LA LISTE DES UTILISATEURS BLOQUÉS
router.get('/', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('blocks')
      .select('id, blocked_user_id, created_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erreur liste blocages :', error);

      return res.status(500).json({
        success: false,
        message: 'Impossible de récupérer les utilisateurs bloqués.',
      });
    }

    return res.json({
      success: true,
      blocks: data ?? [],
    });
  } catch (error) {
    console.error('Erreur liste blocages :', error);

    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

// DÉBLOQUER UN UTILISATEUR
router.delete('/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;

    if (!isValidUuid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Identifiant utilisateur invalide.',
      });
    }

    const { data, error } = await supabaseAdmin
      .from('blocks')
      .delete()
      .eq('user_id', req.user.id)
      .eq('blocked_user_id', userId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('Erreur déblocage :', error);

      return res.status(500).json({
        success: false,
        message: 'Impossible de débloquer cet utilisateur.',
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'Cet utilisateur n’est pas dans ta liste de blocage.',
      });
    }

    return res.json({
      success: true,
      message: 'Utilisateur débloqué.',
    });
  } catch (error) {
    console.error('Erreur déblocage :', error);

    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

export default router;
