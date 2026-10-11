import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const BUCKET = 'ose-photos';
const SIGNED_URL_SECONDS = 15 * 60;
const PAGE_SIZE = 200;
const MAX_PAGES = 5;
const MAX_PHOTOS_PER_PROFILE = 6;

function formatDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function subtractYears(date, years) {
  const result = new Date(date);
  const originalDay = result.getUTCDate();

  result.setUTCDate(1);
  result.setUTCFullYear(result.getUTCFullYear() - years);

  const lastDay = new Date(
    Date.UTC(
      result.getUTCFullYear(),
      result.getUTCMonth() + 1,
      0,
    ),
  ).getUTCDate();

  result.setUTCDate(Math.min(originalDay, lastDay));

  return result;
}

function calculateAge(birthDateString, today) {
  const birthDate = new Date(`${birthDateString}T00:00:00.000Z`);

  if (Number.isNaN(birthDate.getTime())) {
    return null;
  }

  let age = today.getUTCFullYear() - birthDate.getUTCFullYear();

  const birthdayNotReached =
    today.getUTCMonth() < birthDate.getUTCMonth() ||
    (
      today.getUTCMonth() === birthDate.getUTCMonth() &&
      today.getUTCDate() < birthDate.getUTCDate()
    );

  if (birthdayNotReached) {
    age--;
  }

  return age;
}

function isValidPhotoPath(storagePath, userId) {
  if (typeof storagePath !== 'string') {
    return false;
  }

  if (!storagePath.startsWith(`${userId}/`)) {
    return false;
  }

  const filename = storagePath.slice(userId.length + 1);

  return /^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(filename);
}

// DÉCOUVRIR DES PROFILS
router.get('/', requireAuth, async (req, res) => {
  try {
    const minimumAge = Number(req.query.minimumAge ?? 18);
    const maximumAge = Number(req.query.maximumAge ?? 99);
    const city = String(req.query.city ?? '').trim().slice(0, 120);
    const interest = String(req.query.interest ?? '').trim().slice(0, 80);

    const requestedLimit = Number(req.query.limit ?? 20);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.floor(requestedLimit), 1), 50)
      : 20;

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

    const today = new Date();
    const todayDate = formatDate(today);

    const latestBirthDate = formatDate(
      subtractYears(today, minimumAge),
    );

    const earliestBirthDate = formatDate(
      new Date(
        subtractYears(today, maximumAge + 1).getTime() +
          24 * 60 * 60 * 1000,
      ),
    );

    // Récupérer les profils bloqués dans les deux sens.
    const [
      { data: blockedByMe, error: blockedError },
      { data: blockedMe, error: blockedMeError },
      { data: alreadyLiked, error: likesError },
      { data: alreadyPassed, error: passesError },
    ] = await Promise.all([
      supabaseAdmin
        .from('blocks')
        .select('blocked_user_id')
        .eq('user_id', req.user.id),

      supabaseAdmin
        .from('blocks')
        .select('user_id')
        .eq('blocked_user_id', req.user.id),

      supabaseAdmin
        .from('likes')
        .select('liked_user_id')
        .eq('user_id', req.user.id),

      supabaseAdmin
        .from('passes')
        .select('passed_user_id')
        .eq('user_id', req.user.id),
    ]);

    if (blockedError || blockedMeError || likesError || passesError) {
      console.error('Erreur récupération des exclusions de découverte :', {
        blockedError,
        blockedMeError,
        likesError,
        passesError,
      });

      return res.status(500).json({
        success: false,
        message: 'Impossible de charger les profils.',
      });
    }

    const excludedIds = new Set([
      req.user.id,
      ...(blockedByMe ?? []).map((item) => item.blocked_user_id),
      ...(blockedMe ?? []).map((item) => item.user_id),
      ...(alreadyLiked ?? []).map((item) => item.liked_user_id),
      ...(alreadyPassed ?? []).map((item) => item.passed_user_id),
    ]);

    // Parcourir plusieurs pages pour trouver suffisamment de profils.
    const visibleProfiles = [];
    let offset = 0;

    for (let page = 0; page < MAX_PAGES; page++) {
      let query = supabaseAdmin
        .from('profiles')
        .select(
          'id, name, birth_date, city, bio, looking_for, interests, created_at',
        )
        .gte('birth_date', earliestBirthDate)
        .lte('birth_date', latestBirthDate)
        .lte('birth_date', todayDate)
        .neq('id', req.user.id)
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

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

      const batch = profiles ?? [];

      for (const profile of batch) {
        if (excludedIds.has(profile.id)) {
          continue;
        }

        const age = calculateAge(profile.birth_date, today);

        if (age === null || age < minimumAge || age > maximumAge) {
          continue;
        }

        visibleProfiles.push({ ...profile, age });

        if (visibleProfiles.length >= limit) {
          break;
        }
      }

      if (
        visibleProfiles.length >= limit ||
        batch.length < PAGE_SIZE
      ) {
        break;
      }

      offset += PAGE_SIZE;
    }

    const profileIds = visibleProfiles.map((profile) => profile.id);
    const photosByUser = Object.create(null);

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

      const photoCounts = Object.create(null);

      for (const photo of photos ?? []) {
        const userId = photo.user_id;

        if (!photosByUser[userId]) {
          photosByUser[userId] = [];
          photoCounts[userId] = 0;
        }

        if (photoCounts[userId] >= MAX_PHOTOS_PER_PROFILE) {
          continue;
        }

        if (!isValidPhotoPath(photo.storage_path, userId)) {
          console.error('Chemin de photo invalide pour le profil :', userId);
          continue;
        }

        const { data: signedData, error: signedError } =
          await supabaseAdmin.storage
            .from(BUCKET)
            .createSignedUrl(photo.storage_path, SIGNED_URL_SECONDS);

        if (signedError || !signedData?.signedUrl) {
          console.error('Impossible de créer une URL temporaire de photo :', {
            userId,
            photoId: photo.id,
            error: signedError?.message,
          });

          continue;
        }

        photosByUser[userId].push({
          id: photo.id,
          url: signedData.signedUrl,
          position: photo.position,
        });

        photoCounts[userId]++;
      }
    }

    const result = visibleProfiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      age: profile.age,
      city: profile.city,
      bio: profile.bio,
      lookingFor: profile.looking_for,
      interests: profile.interests ?? [],
      photos: photosByUser[profile.id] ?? [],
    }));

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
