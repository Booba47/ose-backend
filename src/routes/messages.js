
import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { isNonEmptyString, isValidUuid } from '../utils/validation.js';

const router = Router();

const MAX_MESSAGE_LENGTH = 5000;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

// Vérifier l'accès à une conversation et les éventuels blocages.
async function getAuthorizedConversation(conversationId, userId) {
  const { data: conversation, error: conversationError } =
    await supabaseAdmin
      .from('conversations')
      .select('id, match_id')
      .eq('id', conversationId)
      .maybeSingle();

  if (conversationError) {
    console.error('Erreur lecture conversation :', conversationError);
    return { conversation: null, error: 'DATABASE_ERROR' };
  }

  if (!conversation) {
    return { conversation: null, error: null };
  }

  const { data: match, error: matchError } = await supabaseAdmin
    .from('matches')
    .select('id, user_one_id, user_two_id')
    .eq('id', conversation.match_id)
    .maybeSingle();

  if (matchError) {
    console.error('Erreur vérification match :', matchError);
    return { conversation: null, error: 'DATABASE_ERROR' };
  }

  if (
    !match ||
    (match.user_one_id !== userId && match.user_two_id !== userId)
  ) {
    return { conversation: null, error: null };
  }

  const otherUserId =
    match.user_one_id === userId
      ? match.user_two_id
      : match.user_one_id;

  const { data: blocks, error: blockError } = await supabaseAdmin
    .from('blocks')
    .select('id')
    .or(
      `and(user_id.eq.${userId},blocked_user_id.eq.${otherUserId}),and(user_id.eq.${otherUserId},blocked_user_id.eq.${userId})`,
    )
    .limit(1);

  if (blockError) {
    console.error('Erreur vérification blocage conversation :', blockError);
    return { conversation: null, error: 'DATABASE_ERROR' };
  }

  if (blocks?.length) {
    return { conversation: null, error: 'BLOCKED' };
  }

  return { conversation, error: null };
}

function respondConversationError(res, error) {
  if (error === 'DATABASE_ERROR') {
    return res.status(500).json({
      success: false,
      message: 'Impossible de vérifier la conversation.',
    });
  }

  return res.status(404).json({
    success: false,
    message: 'Conversation introuvable ou inaccessible.',
  });
}

// LISTER LES MESSAGES D'UNE CONVERSATION
router.get('/:conversationId', requireAuth, async (req, res) => {
  try {
    const { conversationId } = req.params;

    if (!isValidUuid(conversationId)) {
      return res.status(400).json({
        success: false,
        message: 'Identifiant de conversation invalide.',
      });
    }

    const { conversation, error: authorizationError } =
      await getAuthorizedConversation(conversationId, req.user.id);

    if (!conversation) {
      return respondConversationError(res, authorizationError);
    }

    const requestedLimit = Number(req.query.limit ?? DEFAULT_PAGE_SIZE);
    const limit = Number.isInteger(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

    let query = supabaseAdmin
      .from('messages')
      .select('id, conversation_id, sender_id, text, is_read, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);

    if (req.query.before !== undefined) {
      const before = String(req.query.before);

      if (
        before.length > 40 ||
        Number.isNaN(Date.parse(before))
      ) {
        return res.status(400).json({
          success: false,
          message: 'Date de pagination invalide.',
        });
      }

      query = query.lt('created_at', before);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Erreur lecture messages :', error);

      return res.status(500).json({
        success: false,
        message: 'Impossible de récupérer les messages.',
      });
    }

    // Le plus récent est récupéré en premier par la base.
    // On inverse le lot pour l'affichage chronologique.
    const messages = (data ?? []).reverse().map((message) => ({
      ...message,
      isMine: message.sender_id === req.user.id,
    }));

    return res.json({
      success: true,
      count: messages.length,
      messages,
      hasMore: messages.length === limit,
      nextBefore: messages.length > 0
        ? messages[0].created_at
        : null,
    });
  } catch (error) {
    console.error('Erreur route messages :', error);

    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

// ENVOYER UN MESSAGE
router.post('/:conversationId', requireAuth, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const text = typeof req.body?.text === 'string'
      ? req.body.text.trim()
      : '';

    if (!isValidUuid(conversationId)) {
      return res.status(400).json({
        success: false,
        message: 'Identifiant de conversation invalide.',
      });
    }

    if (!isNonEmptyString(text) || text.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        success: false,
        message: 'Le message doit contenir entre 1 et 5000 caractères.',
      });
    }

    const { conversation, error: authorizationError } =
      await getAuthorizedConversation(conversationId, req.user.id);

    if (!conversation) {
      return respondConversationError(res, authorizationError);
    }

    const { data: message, error } = await supabaseAdmin
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: req.user.id,
        text,
      })
      .select('id, conversation_id, sender_id, text, is_read, created_at')
      .single();

    if (error) {
      console.error('Erreur envoi message :', error);

      return res.status(500).json({
        success: false,
        message: 'Impossible d’envoyer le message.',
      });
    }

    return res.status(201).json({
      success: true,
      message: {
        ...message,
        isMine: true,
      },
    });
  } catch (error) {
    console.error('Erreur envoi message :', error);

    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

// MARQUER LES MESSAGES REÇUS COMME LUS
router.patch('/:conversationId/read', requireAuth, async (req, res) => {
  try {
    const { conversationId } = req.params;

    if (!isValidUuid(conversationId)) {
      return res.status(400).json({
        success: false,
        message: 'Identifiant de conversation invalide.',
      });
    }

    const { conversation, error: authorizationError } =
      await getAuthorizedConversation(conversationId, req.user.id);

    if (!conversation) {
      return respondConversationError(res, authorizationError);
    }

    const { error } = await supabaseAdmin
      .from('messages')
      .update({ is_read: true })
      .eq('conversation_id', conversationId)
      .neq('sender_id', req.user.id)
      .eq('is_read', false);

    if (error) {
      console.error('Erreur marquage messages lus :', error);

      return res.status(500).json({
        success: false,
        message: 'Impossible de marquer les messages comme lus.',
      });
    }

    return res.json({
      success: true,
      message: 'Messages marqués comme lus.',
    });
  } catch (error) {
    console.error('Erreur marquage messages :', error);

    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

// SUPPRIMER UNE CONVERSATION
router.delete('/:conversationId', requireAuth, async (req, res) => {
  try {
    const { conversationId } = req.params;

    if (!isValidUuid(conversationId)) {
      return res.status(400).json({
        success: false,
        message: 'Identifiant de conversation invalide.',
      });
    }

    const { conversation, error: authorizationError } =
      await getAuthorizedConversation(conversationId, req.user.id);

    if (!conversation) {
      return respondConversationError(res, authorizationError);
    }

    // Le match est conservé.
    // La suppression des messages dépend de la contrainte
    // ON DELETE CASCADE sur messages.conversation_id.
    const { error } = await supabaseAdmin
      .from('conversations')
      .delete()
      .eq('id', conversationId);

    if (error) {
      console.error('Erreur suppression conversation :', error);

      return res.status(500).json({
        success: false,
        message: 'Impossible de supprimer la conversation.',
      });
    }

    return res.json({
      success: true,
      message: 'Conversation supprimée.',
    });
  } catch (error) {
    console.error('Erreur suppression conversation :', error);

    return res.status(500).json({
      success: false,
      message: 'Erreur interne.',
    });
  }
});

export default router;
 
