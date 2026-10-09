import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { isNonEmptyString, isValidUuid } from '../utils/validation.js';

const router = Router();

// Vérifie que l'utilisateur appartient au match.
async function getAuthorizedConversation(conversationId, userId) {
  const { data: conversation, error } = await supabaseAdmin
    .from('conversations')
    .select('id, match_id')
    .eq('id', conversationId)
    .maybeSingle();

  if (error || !conversation) {
    return { conversation: null, error };
  }

  const { data: match, error: matchError } = await supabaseAdmin
    .from('matches')
    .select('id, user_one_id, user_two_id')
    .eq('id', conversation.match_id)
    .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`)
    .maybeSingle();

  if (matchError || !match) {
    return { conversation: null, error: matchError };
  }

  const otherUserId =
    match.user_one_id === userId
      ? match.user_two_id
      : match.user_one_id;

  const { data: block, error: blockError } = await supabaseAdmin
    .from('blocks')
    .select('id')
    .or(
      `and(user_id.eq.${userId},blocked_user_id.eq.${otherUserId}),and(user_id.eq.${otherUserId},blocked_user_id.eq.${userId})`,
    )
    .limit(1);

  if (blockError || block?.length) {
    return { conversation: null, error: blockError };
  }

  return { conversation, error: null };
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

    const { conversation } = await getAuthorizedConversation(
      conversationId,
      req.user.id,
    );

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation introuvable ou inaccessible.',
      });
    }

    const { data, error } = await supabaseAdmin
      .from('messages')
      .select('id, conversation_id, sender_id, text, is_read, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(200);

    if (error) {
      console.error('Erreur lecture messages :', error);
      return res.status(500).json({
        success: false,
        message: 'Impossible de récupérer les messages.',
      });
    }

    return res.json({
      success: true,
      messages: (data ?? []).map((message) => ({
        ...message,
        isMine: message.sender_id === req.user.id,
      })),
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

    if (!isNonEmptyString(text) || text.length > 5000) {
      return res.status(400).json({
        success: false,
        message: 'Le message doit contenir entre 1 et 5000 caractères.',
      });
    }

    const { conversation } = await getAuthorizedConversation(
      conversationId,
      req.user.id,
    );

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation introuvable ou inaccessible.',
      });
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

    const { conversation } = await getAuthorizedConversation(
      conversationId,
      req.user.id,
    );

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation introuvable ou inaccessible.',
      });
    }

    const { error } = await supabaseAdmin
      .from('messages')
      .update({ is_read: true })
      .eq('conversation_id', conversationId)
      .neq('sender_id', req.user.id)
      .eq('is_read', false);

    if (error) {
      console.error('Erreur lecture messages :', error);
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

    const { conversation } = await getAuthorizedConversation(
      conversationId,
      req.user.id,
    );

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation introuvable ou inaccessible.',
      });
    }

    // Supprimer la conversation supprime ses messages grâce au CASCADE SQL.
    // Le match associé est conservé.
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
