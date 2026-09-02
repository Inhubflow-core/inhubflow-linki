/**
 * Chatwoot Hub Integration Service
 * Dispatches outreach replies (LinkedIn DMs, Cold Email replies) directly
 * into the customer's Chatwoot Omnichannel Inbox.
 */

interface LeadPayload {
  name: string;
  email?: string | null;
  linkedinUrl?: string | null;
  phone?: string | null;
  companyName?: string | null;
  jobTitle?: string | null;
}

interface PushConversationOptions {
  chatwootAccountId?: string | number;
  lead: LeadPayload;
  messageContent: string;
  channelType: "linkedin" | "email";
  inboxId?: number;
}

export async function pushLeadToChatwoot({
  chatwootAccountId,
  lead,
  messageContent,
  channelType = "linkedin",
  inboxId,
}: PushConversationOptions): Promise<{ success: boolean; contactId?: number; conversationId?: number; error?: string }> {
  const baseUrl = process.env.CHATWOOT_API_BASE_URL || "http://localhost:3000";
  const apiToken = process.env.CHATWOOT_ADMIN_API_TOKEN || process.env.CHATWOOT_API_KEY;
  const targetAccountId = chatwootAccountId || process.env.DEFAULT_CHATWOOT_ACCOUNT_ID || "1";

  if (!apiToken) {
    console.warn("[Chatwoot Bridge] CHATWOOT_ADMIN_API_TOKEN is not configured; skipping sync.");
    return { success: false, error: "Missing CHATWOOT_ADMIN_API_TOKEN" };
  }

  try {
    // 1. Create or Find Contact in Chatwoot
    const contactRes = await fetch(`${baseUrl}/api/v1/accounts/${targetAccountId}/contacts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        api_access_token: apiToken,
      },
      body: JSON.stringify({
        name: lead.name,
        email: lead.email || undefined,
        phone_number: lead.phone || undefined,
        custom_attributes: {
          linkedin_url: lead.linkedinUrl || undefined,
          company: lead.companyName || undefined,
          job_title: lead.jobTitle || undefined,
          source: `InHubFlow Outreach (${channelType.toUpperCase()})`,
        },
      }),
    });

    let contactId: number | null = null;

    if (contactRes.ok) {
      const contactData = await contactRes.json();
      contactId = contactData?.payload?.contact?.id || contactData?.id;
    } else if (contactRes.status === 422 && lead.email) {
      // Contact likely already exists; search by email
      const searchRes = await fetch(
        `${baseUrl}/api/v1/accounts/${targetAccountId}/contacts/search?q=${encodeURIComponent(lead.email)}`,
        {
          headers: { api_access_token: apiToken },
        }
      );
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        contactId = searchData?.payload?.[0]?.id;
      }
    }

    if (!contactId) {
      return { success: false, error: "Failed to create or resolve Chatwoot contact" };
    }

    // 2. Resolve or fallback to default inbox if not provided
    let targetInboxId = inboxId;
    if (!targetInboxId) {
      const inboxesRes = await fetch(`${baseUrl}/api/v1/accounts/${targetAccountId}/inboxes`, {
        headers: { api_access_token: apiToken },
      });
      if (inboxesRes.ok) {
        const inboxesData = await inboxesRes.json();
        const inboxesList = inboxesData?.payload || [];
        targetInboxId = inboxesList[0]?.id;
      }
    }

    if (!targetInboxId) {
      return { success: false, error: "No active Inbox found in Chatwoot to route conversation" };
    }

    // 3. Create Conversation & Append Message
    const convRes = await fetch(`${baseUrl}/api/v1/accounts/${targetAccountId}/conversations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        api_access_token: apiToken,
      },
      body: JSON.stringify({
        inbox_id: targetInboxId,
        contact_id: contactId,
        message: {
          content: messageContent,
          message_type: "incoming",
        },
        custom_attributes: {
          outreach_channel: channelType,
        },
      }),
    });

    if (!convRes.ok) {
      const errText = await convRes.text();
      return { success: false, error: `Conversation creation failed: ${errText}` };
    }

    const convData = await convRes.json();
    return {
      success: true,
      contactId,
      conversationId: convData?.id || convData?.payload?.id,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[Chatwoot Bridge] Error syncing lead:", errorMsg);
    return { success: false, error: errorMsg };
  }
}
