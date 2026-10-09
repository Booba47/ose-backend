import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { cleanString, isNonEmptyString } from '../utils/validation.js';

const router = Router();

const BUCKET = 'ose-photos';
const MAX_PHOTOS = 6;
const MAX_FILE_SIZE = 5 * 1024 * 1024;

const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// LISTE MES PHOTOS
router.get('/', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('photos')
      .select('id, storage_path, photo_url, position, created_at')
      .eq('user_id', req.user.id)
      .order('position', { ascending: true });

    if (error) {
      console.error('Erreur lecture photos :', error);
      return res.status(500).json({
        success: false,
        message: 'Impossible de récupérer les photos.',
      });
    }

    return res.json({
      success: true,
      photos: data ?? [],
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

// PRÉPARER UN TÉLÉVERSEMENT SÉCURISÉ
// Le serveur renvoie une URL signée temporaire.
// Le fichier sera ensuite envoyé directement à Supabase Storage.
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

    if (!ALLOWED_TYPES[contentType]) {
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

    const extension = ALLOWED_TYPES[contentType];
    const storagePath = `${req.user.id}/${crypto.randomUUID()}.${extension}`;

    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUploadUrl(storagePath);

    if (error || !data) {
      console.error('Erreur URL de téléversement :', error);
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
    });
  } catch (error) {
    console.error('Erreur préparation photo :', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

// ENREGISTRER UNE PHOTO APRÈS SON TÉLÉVERSEMENT
router.post('/confirm', requireAuth, async (req, res) => {
  try {
    const storagePath = cleanString(req.body?.storagePath);

    if (!isNonEmptyString(storagePath)) {
      return res.status(400).json({
        success: false,
        message: 'Chemin de photo manquant.',
      });
    }

    if (!storagePath.startsWith(`${req.user.id}/`)) {
      return res.status(403).json({
        success: false,
        message: 'Cette photo ne t’appartient pas.',
      });
    }

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('photos')
      .select('id')
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
        photo: existing,
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

    const { data: storedFile, error: storageError } = await supabaseAdmin.storage
      .from(BUCKET)
      .list(req.user.id, { limit: 100 });

    const fileName = storagePath.split('/').pop();

    if (
      storageError ||
      !(storedFile ?? []).some((file) => file.name === fileName)
    ) {
      return res.status(400).json({
        success: false,
        message: 'Photo introuvable dans le stockage.',
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
      .select('id, storage_path, photo_url, position, created_at')
      .single();

    if (error) {
      console.error('Erreur enregistrement photo :', error);
      return res.status(500).json({
        success: false,
        message: 'Impossible d’enregistrer la photo.',
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Photo enregistrée.',
      photo,
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
    const photoId = cleanString(req.params.photoId);

    if (!isNonEmptyString(photoId)) {
      return res.status(400).json({
        success: false,
        message: 'Identifiant de photo invalide.',
      });
    }

    const { data: photo, error: photoError } = await supabaseAdmin
      .from('photos')
      .select('id, user_id, position')
      .eq('id', photoId)
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (photoError || !photo) {
      return res.status(404).json({
        success: false,
        message: 'Photo introuvable.',
      });
    }

    const { data: photos, error: listError } = await supabaseAdmin
      .from('photos')
      .select('id, position')
      .eq('user_id', req.user.id)
      .order('position', { ascending: true });

    if (listError) {
      return res.status(500).json({
        success: false,
        message: 'Impossible de réorganiser les photos.',
      });
    }

    const ordered = [
      photo,
      ...(photos ?? []).filter((item) => item.id !== photo.id),
    ];

    for (let index = 0; index < ordered.length; index++) {
      const { error } = await supabaseAdmin
        .from('photos')
        .update({ position: index })
        .eq('id', ordered[index].id)
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
    const photoId = cleanString(req.params.photoId);

    const { data: photo, error: findError } = await supabaseAdmin
      .from('photos')
      .select('id, storage_path')
      .eq('id', photoId)
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (findError || !photo) {
      return res.status(404).json({
        success: false,
        message: 'Photo introuvable.',
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
