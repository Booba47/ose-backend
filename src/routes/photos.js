
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { cleanString, isNonEmptyString } from '../utils/validation.js';

const router = Router();

const BUCKET = 'ose-photos';
const MAX_PHOTOS = 6;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const SIGNED_URL_SECONDS = 15 * 60;

const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function validPhotoId(value) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function validStoragePath(path, userId) {
  if (typeof path !== 'string' || path.length > 250) {
    return false;
  }

  const prefix = `${userId}/`;

  if (!path.startsWith(prefix)) {
    return false;
  }

  const filename = path.slice(prefix.length);

  return /^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(filename);
}

async function createPhotoUrl(storagePath) {
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_SECONDS);

  if (error || !data?.signedUrl) {
    console.error('Erreur création URL photo :', error);
    return null;
  }

  return data.signedUrl;
}

// LISTE MES PHOTOS
router.get('/', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('photos')
      .select('id, storage_path, position, created_at')
      .eq('user_id', req.user.id)
      .order('position', { ascending: true });

    if (error) {
      console.error('Erreur lecture photos :', error);
      return res.status(500).json({
        success: false,
        message: 'Impossible de récupérer les photos.',
      });
    }

    const photos = await Promise.all(
      (data ?? []).map(async (photo) => ({
        ...photo,
        photo_url: await createPhotoUrl(photo.storage_path),
      })),
    );

    return res.json({
      success: true,
      photos,
      maxPhotos: MAX_PHOTOS,
    });
  } catch (error) {
    console.error('Erreur photos :', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

// PRÉPARER UN TÉLÉVERSEMENT
router.post('/upload-url', requireAuth, async (req, res) => {
  try {
    const fileName = cleanString(req.body?.fileName);
    const contentType = cleanString(req.body?.contentType).toLowerCase();
    const fileSize = Number(req.body?.fileSize);

    if (!isNonEmptyString(fileName) || fileName.length > 150) {
      return res.status(400).json({
        success: false,
        message: 'Nom de fichier invalide.',
      });
    }

    if (!Object.hasOwn(ALLOWED_TYPES, contentType)) {
      return res.status(400).json({
        success: false,
        message: 'Format accepté : JPG, PNG ou WebP.',
      });
    }

    if (
      !Number.isFinite(fileSize) ||
      fileSize <= 0 ||
      fileSize > MAX_FILE_SIZE
    ) {
      return res.status(400).json({
        success: false,
        message: 'La photo doit peser au maximum 5 Mo.',
      });
    }

    const { count, error: countError } = await supabaseAdmin
      .from('photos')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', req.user.id);

    if (countError) {
      console.error('Erreur comptage photos :', countError);
      return res.status(500).json({
        success: false,
        message: 'Impossible de vérifier le nombre de photos.',
      });
    }

    if ((count ?? 0) >= MAX_PHOTOS) {
      return res.status(400).json({
        success: false,
        message: 'Tu as atteint la limite de 6 photos.',
      });
    }

    const storagePath =
      `${req.user.id}/${randomUUID()}.${ALLOWED_TYPES[contentType]}`;

    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUploadUrl(storagePath);

    if (error || !data?.signedUrl || !data?.token) {
      console.error('Erreur URL téléversement :', error);
      return res.status(500).json({
        success: false,
        message: 'Impossible de préparer le téléversement.',
      });
    }

    return res.json({
      success: true,
      bucket: BUCKET,
      storagePath,
      signedUrl: data.signedUrl,
      token: data.token,
      expiresInSeconds: 7200,
      maxFileSize: MAX_FILE_SIZE,
      allowedTypes: Object.keys(ALLOWED_TYPES),
    });
  } catch (error) {
    console.error('Erreur préparation photo :', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

// CONFIRMER LE TÉLÉVERSEMENT
router.post('/confirm', requireAuth, async (req, res) => {
  let storagePath;

  try {
    storagePath = cleanString(req.body?.storagePath);

    if (!validStoragePath(storagePath, req.user.id)) {
      return res.status(400).json({
        success: false,
        message: 'Chemin de photo invalide.',
      });
    }

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('photos')
      .select('id, storage_path, position, created_at')
      .eq('user_id', req.user.id)
      .eq('storage_path', storagePath)
      .maybeSingle();

    if (existingError) {
      console.error('Erreur vérification photo :', existingError);
      return res.status(500).json({
        success: false,
        message: 'Impossible de vérifier la photo.',
      });
    }

    if (existing) {
      return res.json({
        success: true,
        message: 'Photo déjà enregistrée.',
        photo: {
          ...existing,
          photo_url: await createPhotoUrl(existing.storage_path),
        },
      });
    }

    const { data: storedFiles, error: storageError } =
      await supabaseAdmin.storage
        .from(BUCKET)
        .list(req.user.id, { limit: 100 });

    if (storageError) {
      console.error('Erreur vérification stockage :', storageError);
      return res.status(500).json({
        success: false,
        message: 'Impossible de vérifier le stockage.',
      });
    }

    const fileName = storagePath.split('/').pop();

    const storedFile = (storedFiles ?? []).find(
      (file) => file.name === fileName,
    );

    if (!storedFile || storedFile.id == null) {
      return res.status(400).json({
        success: false,
        message: 'Photo introuvable dans le stockage.',
      });
    }

    const metadata = storedFile.metadata;
    const actualSize = Number(metadata?.size);
    const actualType = metadata?.mimetype;

    if (
      !metadata ||
      !Number.isFinite(actualSize) ||
      actualSize <= 0 ||
      actualSize > MAX_FILE_SIZE ||
      !Object.hasOwn(ALLOWED_TYPES, actualType)
    ) {
      await supabaseAdmin.storage.from(BUCKET).remove([storagePath]);

      return res.status(400).json({
        success: false,
        message: 'Fichier invalide ou trop volumineux.',
      });
    }

    const { count, error: countError } = await supabaseAdmin
      .from('photos')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', req.user.id);

    if (countError) {
      console.error('Erreur comptage photos :', countError);
      return res.status(500).json({
        success: false,
        message: 'Impossible de vérifier le nombre de photos.',
      });
    }

    if ((count ?? 0) >= MAX_PHOTOS) {
      await supabaseAdmin.storage.from(BUCKET).remove([storagePath]);

      return res.status(400).json({
        success: false,
        message: 'Tu as atteint la limite de 6 photos.',
      });
    }

    const { data: photo, error } = await supabaseAdmin
      .from('photos')
      .insert({
        user_id: req.user.id,
        storage_path: storagePath,
        photo_url: null,
        position: count ?? 0,
      })
      .select('id, storage_path, position, created_at')
      .single();

    if (error) {
      console.error('Erreur enregistrement photo :', error);

      await supabaseAdmin.storage.from(BUCKET).remove([storagePath]);

      return res.status(500).json({
        success: false,
        message: 'Impossible d’enregistrer la photo.',
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Photo enregistrée.',
      photo: {
        ...photo,
        photo_url: await createPhotoUrl(photo.storage_path),
      },
    });
  } catch (error) {
    console.error('Erreur confirmation photo :', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

// CHOISIR LA PHOTO PRINCIPALE
router.patch('/:photoId/primary', requireAuth, async (req, res) => {
  try {
    const photoId = req.params.photoId;

    if (!validPhotoId(photoId)) {
      return res.status(400).json({
        success: false,
        message: 'Identifiant de photo invalide.',
      });
    }

    const { data: photo, error: photoError } = await supabaseAdmin
      .from('photos')
      .select('id')
      .eq('id', photoId)
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (photoError) {
      console.error('Erreur lecture photo :', photoError);
      return res.status(500).json({
        success: false,
        message: 'Impossible de vérifier la photo.',
      });
    }

    if (!photo) {
      return res.status(404).json({
        success: false,
        message: 'Photo introuvable.',
      });
    }

    // Deux requêtes par lots : la photo choisie passe en première position.
    const { data: photos, error: listError } = await supabaseAdmin
      .from('photos')
      .select('id')
      .eq('user_id', req.user.id)
      .order('position', { ascending: true });

    if (listError) {
      console.error('Erreur liste photos :', listError);
      return res.status(500).json({
        success: false,
        message: 'Impossible de réorganiser les photos.',
      });
    }

    const ordered = [
      photoId,
      ...(photos ?? [])
        .map((item) => item.id)
        .filter((id) => id !== photoId),
    ];

    for (let index = 0; index < ordered.length; index++) {
      const { error } = await supabaseAdmin
        .from('photos')
        .update({ position: index })
        .eq('id', ordered[index])
        .eq('user_id', req.user.id);

      if (error) {
        console.error('Erreur réorganisation photos :', error);
        return res.status(500).json({
          success: false,
          message: 'Impossible de réorganiser les photos.',
        });
      }
    }

    return res.json({
      success: true,
      message: 'Photo principale mise à jour.',
    });
  } catch (error) {
    console.error('Erreur photo principale :', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

// SUPPRIMER UNE PHOTO
router.delete('/:photoId', requireAuth, async (req, res) => {
  try {
    const photoId = req.params.photoId;

    if (!validPhotoId(photoId)) {
      return res.status(400).json({
        success: false,
        message: 'Identifiant de photo invalide.',
      });
    }

    const { data: photo, error: findError } = await supabaseAdmin
      .from('photos')
      .select('id, storage_path')
      .eq('id', photoId)
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (findError) {
      console.error('Erreur lecture photo :', findError);
      return res.status(500).json({
        success: false,
        message: 'Impossible de vérifier la photo.',
      });
    }

    if (!photo) {
      return res.status(404).json({
        success: false,
        message: 'Photo introuvable.',
      });
    }

    if (!validStoragePath(photo.storage_path, req.user.id)) {
      return res.status(500).json({
        success: false,
        message: 'Le chemin de la photo est invalide.',
      });
    }

    const { error: storageError } = await supabaseAdmin.storage
      .from(BUCKET)
      .remove([photo.storage_path]);

    if (storageError) {
      console.error('Erreur suppression fichier :', storageError);
      return res.status(500).json({
        success: false,
        message: 'Impossible de supprimer le fichier photo.',
      });
    }

    const { error: deleteError } = await supabaseAdmin
      .from('photos')
      .delete()
      .eq('id', photo.id)
      .eq('user_id', req.user.id);

    if (deleteError) {
      console.error('Erreur suppression ligne photo :', deleteError);
      return res.status(500).json({
        success: false,
        message: 'Le fichier a été supprimé, mais son enregistrement n’a pas pu être supprimé.',
      });
    }

    // Réorganiser les positions restantes après la suppression.
    const { data: remaining, error: remainingError } = await supabaseAdmin
      .from('photos')
      .select('id')
      .eq('user_id', req.user.id)
      .order('position', { ascending: true });

    if (remainingError) {
      console.error('Erreur réorganisation après suppression :', remainingError);
    } else {
      for (let index = 0; index < (remaining ?? []).length; index++) {
        const { error } = await supabaseAdmin
          .from('photos')
          .update({ position: index })
          .eq('id', remaining[index].id)
          .eq('user_id', req.user.id);

        if (error) {
          console.error('Erreur mise à jour position :', error);
          break;
        }
      }
    }

    return res.json({
      success: true,
      message: 'Photo supprimée.',
    });
  } catch (error) {
    console.error('Erreur suppression photo :', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

export default router;
 

    if (storageError) {
      console.error('Erreur suppression fichier :', storageError);
      return res.status(500).json({
        success: false,
        message: 'Impossible de supprimer le fichier photo.',
      });
    }

    const { error: deleteError } = await supabaseAdmin
      .from('photos')
      .delete()
      .eq('id', photo.id)
      .eq('user_id', req.user.id);

    if (deleteError) {
      console.error('Erreur suppression photo :', deleteError);
      return res.status(500).json({
        success: false,
        message: 'Impossible de supprimer la photo.',
      });
    }

    return res.json({
      success: true,
      message: 'Photo supprimée.',
    });
  } catch (error) {
    console.error('Erreur suppression photo :', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

export default router; 
