
import { Router } from 'express';
import { supabase, supabaseAdmin } from '../config/supabase.js';
import {
  isAdult,
  isNonEmptyString,
  isValidEmail,
  isValidPassword,
  cleanString,
} from '../utils/validation.js';

const router = Router();

// INSCRIPTION
router.post('/register', async (req, res) => {
  try {
    const email = cleanString(req.body?.email).toLowerCase();
    const password = req.body?.password;
    const name = cleanString(req.body?.name);
    const birthDate = cleanString(req.body?.birthDate);
    const city = cleanString(req.body?.city);
    const bio = cleanString(req.body?.bio);
    const lookingFor = cleanString(req.body?.lookingFor);

    const interests = Array.isArray(req.body?.interests)
      ? req.body.interests
          .filter((item) => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 30)
      : [];

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Adresse e-mail invalide.',
      });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({
        success: false,
        message: 'Le mot de passe doit contenir au moins 6 caractères.',
      });
    }

    if (!isNonEmptyString(name) || name.length > 80) {
      return res.status(400).json({
        success: false,
        message: 'Le prénom est obligatoire et limité à 80 caractères.',
      });
    }

    if (!isAdult(birthDate)) {
      return res.status(400).json({
        success: false,
        message: 'Ose est réservée aux personnes âgées de 18 ans et plus.',
      });
    }

    if (city.length > 120 || bio.length > 1000 || lookingFor.length > 120) {
      return res.status(400).json({
        success: false,
        message: 'Un des champs du profil est trop long.',
      });
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name },
      },
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Impossible de créer le compte. Vérifie les informations saisies.',
      });
    }

    if (!data.user) {
      return res.status(500).json({
        success: false,
        message: 'La création du compte n’a pas abouti.',
      });
    }

    // Créer le profil et les préférences côté serveur.
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: data.user.id,
        name,
        birth_date: birthDate,
        city,
        bio,
        looking_for: lookingFor,
        interests,
      });

    if (profileError) {
      console.error('Erreur création profil :', profileError);

      // Ne pas supprimer le compte Auth : il pourra être réparé
      // côté serveur sans perdre l'inscription.
      return res.status(500).json({
        success: false,
        accountCreated: true,
        message: 'Compte créé, mais le profil n’a pas pu être enregistré. Contacte le support.',
      });
    }

    const { error: preferencesError } = await supabaseAdmin
      .from('preferences')
      .upsert({ user_id: data.user.id });

    if (preferencesError) {
      console.error('Erreur création préférences :', preferencesError);

      return res.status(500).json({
        success: false,
        accountCreated: true,
        message: 'Compte créé, mais les préférences n’ont pas pu être initialisées.',
      });
    }

    return res.status(201).json({
      success: true,
      message: data.session
        ? 'Compte créé. Tu peux te connecter.'
        : 'Compte créé. Vérifie ton e-mail pour confirmer ton inscription avant de te connecter.',
      user: {
        id: data.user.id,
        email: data.user.email,
      },
      session: data.session
        ? {
            accessToken: data.session.access_token,
            refreshToken: data.session.refresh_token,
          }
        : null,
      requiresEmailConfirmation: !data.session,
    });
  } catch (error) {
    console.error('Erreur inscription :', error);

    return res.status(500).json({
      success: false,
      message: 'Impossible de créer le compte pour le moment.',
    });
  }
});

// CONNEXION
router.post('/login', async (req, res) => {
  try {
    const email = cleanString(req.body?.email).toLowerCase();
    const password = req.body?.password;

    if (!isValidEmail(email) || !isValidPassword(password)) {
      return res.status(400).json({
        success: false,
        message: 'E-mail ou mot de passe invalide.',
      });
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user || !data.session) {
      return res.status(401).json({
        success: false,
        message: 'Identifiants incorrects ou e-mail non confirmé.',
      });
    }

    return res.json({
      success: true,
      message: 'Connexion réussie.',
      user: {
        id: data.user.id,
        email: data.user.email,
      },
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
      },
    });
  } catch (error) {
    console.error('Erreur connexion :', error);

    return res.status(500).json({
      success: false,
      message: 'Impossible de se connecter pour le moment.',
    });
  }
});

// UTILISATEUR CONNECTÉ
router.get('/me', async (req, res) => {
  try {
    const authorization = req.headers.authorization;

    if (!authorization?.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentification requise.',
      });
    }

    const token = authorization.substring(7).trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token manquant.',
      });
    }

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return res.status(401).json({
        success: false,
        message: 'Session invalide ou expirée.',
      });
    }

    return res.json({
      success: true,
      user: {
        id: data.user.id,
        email: data.user.email,
      },
    });
  } catch (error) {
    console.error('Erreur récupération utilisateur :', error);

    return res.status(500).json({
      success: false,
      message: 'Impossible de récupérer la session.',
    });
  }
});

// DÉCONNEXION
router.post('/logout', async (req, res) => {
  try {
    const authorization = req.headers.authorization;

    if (!authorization?.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentification requise.',
      });
    }

    const token = authorization.substring(7).trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token manquant.',
      });
    }

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return res.status(401).json({
        success: false,
        message: 'Session invalide ou expirée.',
      });
    }

    // Révoquer les sessions de cet utilisateur côté serveur.
    const { error: logoutError } =
      await supabaseAdmin.auth.admin.signOut(token, 'global');

    if (logoutError) {
      console.error('Erreur déconnexion Supabase :', logoutError);

      return res.status(500).json({
        success: false,
        message: 'La déconnexion côté serveur a échoué.',
      });
    }

    return res.json({
      success: true,
      message: 'Déconnexion effectuée.',
    });
  } catch (error) {
    console.error('Erreur déconnexion :', error);

    return res.status(500).json({
      success: false,
      message: 'Impossible de se déconnecter pour le moment.',
    });
  }
});

// DEMANDE DE RÉINITIALISATION DU MOT DE PASSE
router.post('/forgot-password', async (req, res) => {
  try {
    const email = cleanString(req.body?.email).toLowerCase();

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Adresse e-mail invalide.',
      });
    }

    const redirectTo = process.env.PASSWORD_RESET_REDIRECT_URL;

    const { error } = await supabase.auth.resetPasswordForEmail(
      email,
      redirectTo ? { redirectTo } : undefined,
    );

    if (error) {
      console.error('Erreur réinitialisation :', error);

      return res.status(500).json({
        success: false,
        message: 'Impossible d’envoyer la demande pour le moment.',
      });
    }

    return res.json({
      success: true,
      message: 'Si cette adresse possède un compte, un e-mail de réinitialisation sera envoyé.',
    });
  } catch (error) {
    console.error('Erreur demande réinitialisation :', error);

    return res.status(500).json({
      success: false,
      message: 'Impossible de traiter la demande pour le moment.',
    });
  }
});

export default router;
 
