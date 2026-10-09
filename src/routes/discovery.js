import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// DÉCOUVRIR DES PROFILS
router.get('/', requireAuth, async (req, res) => {
  try {
    const minimumAge = Number(req.query.minimumAge ?? 18);
    const maximumAge = Number(req.query.maximumAge ?? 99);
    const city = String(req.query.city ?? '').trim();
    const interest = String(req.query.interest ?? '').trim();
    const limit = Math.min(
      Math.max(Number(req.query.limit ?? 20) || 20, 1),
      50,
    );

    if (
      !Number.isInteger(minimumAge) ||
      !Number.isInteger(maximumAge) ||
      minimumAge < 18 ||
      maximumAge < minimumAge ||
      maximumAge > 120
    ) {
      return res.status(400).json({
        success: false,
        message: 'Filtres d’âge invalides.',
      });
    }

    // Calcul des dates de naissance correspondant aux âges.
    const today = new Date();

    const latestBirthDate = new Date(
      today.getFullYear() - minimumAge,
      today.getMonth(),
      today.getDate(),
    );

    const earliestBirthDate = new Date(
      today.getFullYear() - maximumAge - 1,
      today.getMonth(),
      today.getDate() + 1,
    );

    const formatDate = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const { data: blockedByMe, error: blockedError } =
      await supabaseAdmin
        .from('blocks')
        .select('blocked_user_id')
        .eq('user_id', req.user.id);

    if (blockedError) {
      console.error('Erreur récupération blocages :', blockedError);
      return res.status(500).json({
        success: false,
        message: 'Impossible de charger les préférences de découverte.',
      });
    }

    const { data: blockedMe, error: blockedMeError } =
      await supabaseAdmin
        .from('blocks')
        .select('user_id')
        .eq('blocked_user_id', req.user.id);

    if (blockedMeError) {
      console.error('Erreur récupération blocages reçus :', blockedMeError);
      return res.status(500).json({
        success: false,
        message: 'Impossible de charger les profils.',
      });
    }

    const excludedIds = new Set([
      req.user.id,
      ...(blockedByMe ?? []).map((item) => item.blocked_user_id),
      ...(blockedMe ?? []).map((item) => item.user_id),
    ]);

    const { data: alreadyLiked, error: likesError } = await supabaseAdmin
      .from('likes')
      .select('liked_user_id')
      .eq('user_id', req.user.id);

    if (likesError) {
      console.error('Erreur récupération likes :', likesError);
      return res.status(500).json({
        success: false,
        message: 'Impossible de charger les profils.',
      });
    }

    const { data: alreadyPassed, error: passesError } = await supabaseAdmin
      .from('passes')
      .select('passed_user_id')
      .eq('user_id', req.user.id);

    if (passesError) {
      console.error('Erreur récupération profils ignorés :', passesError);
      return res.status(500).json({
        success: false,
        message: 'Impossible de charger les profils.',
      });
    }

    for (const item of alreadyLiked ?? []) {
      excludedIds.add(item.liked_user_id);
    }

    for (const item of alreadyPassed ?? []) {
      excludedIds.add(item.passed_user_id);
    }

    let query = supabaseAdmin
      .from('profiles')
      .select(
        'id, name, birth_date, city, bio, looking_for, interests, created_at',
      )
      .gte('birth_date', formatDate(earliestBirthDate))
      .lte('birth_date', formatDate(latestBirthDate))
      .neq('id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(200);

    if (city) {
      query = query.ilike('city', `%${city}%`);
    }

    if (interest) {
      query = query.contains('interests', [interest]);
    }

    const { data: profiles, error: profilesError } = await query;

    if (profilesError) {
      console.error('Erreur découverte :', profilesError);
      return res.status(500).json({
        success: false,
        message: 'Impossible de charger les profils.',
      });
    }

    const visibleProfiles = (profiles ?? [])
      .filter((profile) => !excludedIds.has(profile.id))
      .slice(0, limit);

    const profileIds = visibleProfiles.map((profile) => profile.id);

    let photosByUser = {};

    if (profileIds.length > 0) {
      const { data: photos, error: photosError } = await supabaseAdmin
        .from('photos')
        .select('id, user_id, storage_path, position')
        .in('user_id', profileIds)
        .order('position', { ascending: true });

      if (photosError) {
        console.error('Erreur lecture photos découverte :', photosError);
        return res.status(500).json({
          success: false,
          message: 'Impossible de charger les photos des profils.',
        });
      }

      for (const photo of photos ?? []) {
        if (!photosByUser[photo.user_id]) {
          photosByUser[photo.user_id] = [];
        }

        const { data: signedData, error: signedError } =
          await supabaseAdmin.storage
            .from('ose-photos')
            .createSignedUrl(photo.storage_path, 3600);

        if (!signedError && signedData?.signedUrl) {
          photosByUser[photo.user_id].push({
            id: photo.id,
            url: signedData.signedUrl,
            position: photo.position,
          });
        }
      }
    }

    const result = visibleProfiles.map((profile) => {
      const birthDate = new Date(`${profile.birth_date}T00:00:00`);
      const now = new Date();

      let age = now.getFullYear() - birthDate.getFullYear();

      if (
        now.getMonth() < birthDate.getMonth() ||
        (now.getMonth() === birthDate.getMonth() &&
          now.getDate() < birthDate.getDate())
      ) {
        age--;
      }

      return {
        id: profile.id,
        name: profile.name,
        age,
        city: profile.city,
        bio: profile.bio,
        lookingFor: profile.looking_for,
        interests: profile.interests ?? [],
        photos: photosByUser[profile.id] ?? [],
      };
    });

    return res.json({
      success: true,
      count: result.length,
      profiles: result,
    });
  } catch (error) {
    console.error('Erreur route découverte :', error);

    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

export default router;
