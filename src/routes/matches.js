import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { isValidUuid } from '../utils/validation.js';

const router = Router();

// CONSULTER MES MATCHS
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: matches, error } = await supabaseAdmin
      .from('matches')
      .select('id, user_one_id, user_two_id, created_at')
      .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erreur récupération matchs :', error);
      return res.status(500).json({
        success: false,
        message: 'Impossible de récupérer tes matchs.',
      });
    }

    const matchList = matches ?? [];
    const otherUserIds = matchList.map((match) =>
      match.user_one_id === userId
        ? match.user_two_id
        : match.user_one_id,
    );

    if (otherUserIds.length === 0) {
      return res.json({
        success: true,
        count: 0,
        matches: [],
      });
    }

    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from('profiles')
      .select('id, name, birth_date, city, bio, interests')
      .in('id', otherUserIds);

    if (profilesError) {
      console.error('Erreur profils matchs :', profilesError);
      return res.status(500).json({
        success: false,
        message: 'Impossible de récupérer les profils des matchs.',
      });
    }

    const profileMap = new Map(
      (profiles ?? []).map((profile) => [profile.id, profile]),
    );

    const matchIds = matchList.map((match) => match.id);

    const { data: conversations, error: conversationsError } =
      await supabaseAdmin
        .from('conversations')
        .select('id, match_id')
        .in('match_id', matchIds);

    if (conversationsError) {
      console.error('Erreur conversations matchs :', conversationsError);
      return res.status(500).json({
        success: false,
        message: 'Impossible de récupérer les conversations.',
      });
    }

    const conversationMap = new Map(
      (conversations ?? []).map((conversation) => [
        conversation.match_id,
        conversation.id,
      ]),
    );

    const matchesWithProfiles = await Promise.all(
      matchList.map(async (match) => {
        const otherUserId =
          match.user_one_id === userId
            ? match.user_two_id
            : match.user_one_id;

        const profile = profileMap.get(otherUserId);

        if (!profile) return null;

        const birthDate = new Date(`${profile.birth_date}T00:00:00`);
        const today = new Date();

        let age = today.getFullYear() - birthDate.getFullYear();

        if (
          today.getMonth() < birthDate.getMonth() ||
          (today.getMonth() === birthDate.getMonth() &&
            today.getDate() < birthDate.getDate())
        ) {
          age--;
        }

        const { data: photos, error: photosError } = await supabaseAdmin
          .from('photos')
          .select('storage_path, position')
          .eq('user_id', otherUserId)
          .order('position', { ascending: true })
          .limit(1);

        let primaryPhotoUrl = null;

        if (!photosError && photos?.length) {
          const { data: signedPhoto } = await supabaseAdmin.storage
            .from('ose-photos')
            .createSignedUrl(photos[0].storage_path, 3600);

          primaryPhotoUrl = signedPhoto?.signedUrl ?? null;
        }

        return {
          id: match.id,
          createdAt: match.created_at,
          conversationId: conversationMap.get(match.id) ?? null,
          profile: {
            id: profile.id,
            name: profile.name,
            age,
            city: profile.city,
            bio: profile.bio,
            interests: profile.interests ?? [],
            primaryPhotoUrl,
          },
        };
      }),
    );

    const result = matchesWithProfiles.filter(Boolean);

    return res.json({
      success: true,
      count: result.length,
      matches: result,
    });
  } catch (error) {
    console.error('Erreur route matchs :', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

// SUPPRIMER UN MATCH
router.delete('/:matchId', requireAuth, async (req, res) => {
  try {
    const matchId = req.params.matchId;

    if (!isValidUuid(matchId)) {
      return res.status(400).json({
        success: false,
        message: 'Identifiant de match invalide.',
      });
    }

    const { data: match, error: findError } = await supabaseAdmin
      .from('matches')
      .select('id, user_one_id, user_two_id')
      .eq('id', matchId)
      .or(`user_one_id.eq.${req.user.id},user_two_id.eq.${req.user.id}`)
      .maybeSingle();

    if (findError || !match) {
      return res.status(404).json({
        success: false,
        message: 'Match introuvable.',
      });
    }

    const { error } = await supabaseAdmin
      .from('matches')
      .delete()
      .eq('id', matchId);

    if (error) {
      console.error('Erreur suppression match :', error);
      return res.status(500).json({
        success: false,
        message: 'Impossible de supprimer ce match.',
      });
    }

    return res.json({
      success: true,
      message: 'Match supprimé.',
    });
  } catch (error) {
    console.error('Erreur suppression match :', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

export default router;
