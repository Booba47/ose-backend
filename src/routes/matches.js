
import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { isValidUuid } from '../utils/validation.js';

const router = Router();

const BUCKET = 'ose-photos';
const SIGNED_URL_SECONDS = 15 * 60;
const MAX_MATCHES = 200;

function calculateAge(birthDateString) {
  if (!birthDateString) return null;

  const birthDate = new Date(`${birthDateString}T00:00:00.000Z`);

  if (Number.isNaN(birthDate.getTime())) return null;

  const today = new Date();

  let age = today.getUTCFullYear() - birthDate.getUTCFullYear();

  if (
    today.getUTCMonth() < birthDate.getUTCMonth() ||
    (
      today.getUTCMonth() === birthDate.getUTCMonth() &&
      today.getUTCDate() < birthDate.getUTCDate()
    )
  ) {
    age--;
  }

  return age;
}

function isValidPhotoPath(storagePath, userId) {
  if (typeof storagePath !== 'string') return false;
  if (!storagePath.startsWith(`${userId}/`)) return false;

  const filename = storagePath.slice(userId.length + 1);

  return /^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(filename);
}

// CONSULTER MES MATCHS
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: matches, error: matchesError } = await supabaseAdmin
      .from('matches')
      .select('id, user_one_id, user_two_id, created_at')
      .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`)
      .order('created_at', { ascending: false })
      .limit(MAX_MATCHES);

    if (matchesError) {
      console.error('Erreur récupération matchs :', matchesError);

      return res.status(500).json({
        success: false,
        message: 'Impossible de récupérer tes matchs.',
      });
    }

    const matchList = matches ?? [];

    if (matchList.length === 0) {
      return res.json({
        success: true,
        count: 0,
        matches: [],
      });
    }

    const otherUserIds = [
      ...new Set(
        matchList.map((match) =>
          match.user_one_id === userId
            ? match.user_two_id
            : match.user_one_id,
        ),
      ),
    ];

    // Charger les profils associés aux matchs.
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

    // Masquer les personnes bloquées dans un sens ou dans l'autre.
    const { data: blocks, error: blocksError } = await supabaseAdmin
      .from('blocks')
      .select('user_id, blocked_user_id')
      .or(
        `and(user_id.eq.${userId},blocked_user_id.in.(${otherUserIds.join(',')})),and(blocked_user_id.eq.${userId},user_id.in.(${otherUserIds.join(',')}))`,
      );

    if (blocksError) {
      console.error('Erreur vérification blocages des matchs :', blocksError);

      return res.status(500).json({
        success: false,
        message: 'Impossible de vérifier les matchs.',
      });
    }

    const blockedIds = new Set();

    for (const block of blocks ?? []) {
      if (block.user_id === userId) {
        blockedIds.add(block.blocked_user_id);
      } else if (block.blocked_user_id === userId) {
        blockedIds.add(block.user_id);
      }
    }

    const visibleMatches = matchList.filter((match) => {
      const otherUserId =
        match.user_one_id === userId
          ? match.user_two_id
          : match.user_one_id;

      return !blockedIds.has(otherUserId) && profileMap.has(otherUserId);
    });

    if (visibleMatches.length === 0) {
      return res.json({
        success: true,
        count: 0,
        matches: [],
      });
    }

    const visibleMatchIds = visibleMatches.map((match) => match.id);

    const { data: conversations, error: conversationsError } =
      await supabaseAdmin
        .from('conversations')
        .select('id, match_id')
        .in('match_id', visibleMatchIds);

    if (conversationsError) {
      console.error(
        'Erreur récupération conversations des matchs :',
        conversationsError,
      );

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

    // Charger les photos en une seule requête.
    const visibleUserIds = [
      ...new Set(
        visibleMatches.map((match) =>
          match.user_one_id === userId
            ? match.user_two_id
            : match.user_one_id,
        ),
      ),
    ];

    const { data: photos, error: photosError } = await supabaseAdmin
      .from('photos')
      .select('id, user_id, storage_path, position')
      .in('user_id', visibleUserIds)
      .order('position', { ascending: true });

    if (photosError) {
      console.error('Erreur lecture photos des matchs :', photosError);

      return res.status(500).json({
        success: false,
        message: 'Impossible de récupérer les photos des matchs.',
      });
    }

    // Garder uniquement la première photo valide de chaque profil.
    const primaryPhotoByUser = new Map();

    for (const photo of photos ?? []) {
      if (primaryPhotoByUser.has(photo.user_id)) continue;

      if (!isValidPhotoPath(photo.storage_path, photo.user_id)) {
        console.error(
          'Chemin de photo invalide dans un match :',
          photo.user_id,
          photo.id,
        );
        continue;
      }

      primaryPhotoByUser.set(photo.user_id, photo);
    }

    const photoUrlByUser = new Map();

    await Promise.all(
      [...primaryPhotoByUser.entries()].map(async ([photoUserId, photo]) => {
        const { data, error } = await supabaseAdmin.storage
          .from(BUCKET)
          .createSignedUrl(photo.storage_path, SIGNED_URL_SECONDS);

        if (error || !data?.signedUrl) {
          console.error('Erreur URL photo du match :', {
            userId: photoUserId,
            photoId: photo.id,
            error: error?.message,
          });

          photoUrlByUser.set(photoUserId, null);
          return;
        }

        photoUrlByUser.set(photoUserId, data.signedUrl);
      }),
    );

    const result = visibleMatches.map((match) => {
      const otherUserId =
        match.user_one_id === userId
          ? match.user_two_id
          : match.user_one_id;

      const profile = profileMap.get(otherUserId);

      return {
        id: match.id,
        createdAt: match.created_at,
        conversationId: conversationMap.get(match.id) ?? null,
        profile: {
          id: profile.id,
          name: profile.name,
          age: calculateAge(profile.birth_date),
          city: profile.city,
          bio: profile.bio,
          interests: profile.interests ?? [],
          primaryPhotoUrl: photoUrlByUser.get(otherUserId) ?? null,
        },
      };
    });

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
    const userId = req.user.id;

    if (!isValidUuid(matchId)) {
      return res.status(400).json({
        success: false,
        message: 'Identifiant de match invalide.',
      });
    }

    // Vérifier que le match appartient bien à l'utilisateur.
    const { data: match, error: findError } = await supabaseAdmin
      .from('matches')
      .select('id')
      .eq('id', matchId)
      .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`)
      .maybeSingle();

    if (findError) {
      console.error('Erreur vérification match :', findError);

      return res.status(500).json({
        success: false,
        message: 'Impossible de vérifier ce match.',
      });
    }

    if (!match) {
      return res.status(404).json({
        success: false,
        message: 'Match introuvable.',
      });
    }

    // La suppression des conversations et messages associés dépend
    // des contraintes ON DELETE définies dans le schéma SQL.
    const { error: deleteError } = await supabaseAdmin
      .from('matches')
      .delete()
      .eq('id', matchId);

    if (deleteError) {
      console.error('Erreur suppression match :', deleteError);

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
 
