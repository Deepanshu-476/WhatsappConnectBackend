import test from "node:test";
import assert from "node:assert/strict";
import dotenv from "dotenv";
import mongoose from "mongoose";

import { connectDb } from "../src/config/db.js";
import { AccountMember } from "../src/models/account-member.js";

dotenv.config();

const BASE_URL = process.env.API_BASE_URL || "http://localhost:5000";

test.before(async () => {
  if (mongoose.connection.readyState !== 1) {
    await connectDb();
  }
});

test.after(async () => {
  await mongoose.disconnect();
});

// Helper for fetch with cookiejar
class TestClient {
  constructor() {
    this.cookie = "";
    this.user = null;
    this.account = null;
    this.profile = null;
  }

  async request(path, options = {}) {
    const url = `${BASE_URL}${path}`;
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };
    if (this.cookie) {
      headers["Cookie"] = this.cookie;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      const match = setCookie.match(/wacrm_session=[^;]+/);
      if (match) {
        this.cookie = match[0];
      }
    }

    let data = null;
    const text = await response.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    return { status: response.status, ok: response.ok, data };
  }

  async signup(fullName, email, password) {
    const res = await this.request("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ fullName, email, password }),
    });
    if (res.ok) {
      this.user = res.data.user;
      this.account = res.data.account;
      this.profile = res.data.profile;
    }
    return res;
  }

  async login(email, password) {
    const res = await this.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) {
      this.user = res.data.user;
      this.account = res.data.account;
      this.profile = res.data.profile;
    }
    return res;
  }

  async logout() {
    const res = await this.request("/api/auth/logout", {
      method: "POST",
    });
    this.cookie = "";
    this.user = null;
    this.account = null;
    this.profile = null;
    return res;
  }
}

test("1. Backend Health Check", async () => {
  const client = new TestClient();
  const res = await client.request("/health");
  assert.equal(res.status, 200);
  assert.equal(res.data.ok, true);
  assert.equal(res.data.database, "connected");
});

test("2. Authentication Lifecycle (Signup, Protected Route, Logout, Re-login)", async () => {
  const client = new TestClient();
  const timestamp = Date.now();
  const email = `auth-test-${timestamp}@ciis.test`;
  const password = "Password123!";

  // 1. Signup creates owner account
  const signupRes = await client.signup("Auth User", email, password);
  assert.equal(signupRes.status, 201, `Signup failed: ${JSON.stringify(signupRes.data)}`);
  assert.ok(signupRes.data.user.id);
  assert.ok(signupRes.data.account.id);
  assert.equal(signupRes.data.profile.account_role, "owner");

  // 2. Protected route access with session cookie
  const meRes = await client.request("/api/auth/me");
  assert.equal(meRes.status, 200);
  assert.equal(meRes.data.user.email, email);

  // 3. Logout clears session
  const logoutRes = await client.logout();
  assert.equal(logoutRes.status, 200);

  // 4. Access protected route without session must fail
  const unauthRes = await client.request("/api/auth/me");
  assert.equal(unauthRes.status, 401);

  // 5. Login restores access
  const loginRes = await client.login(email, password);
  assert.equal(loginRes.status, 200);
  assert.equal(loginRes.data.user.email, email);
});

test("3. Contacts CRUD & Persistence", async () => {
  const client = new TestClient();
  const ts = Date.now();
  await client.signup("Contact Tester", `contacts-${ts}@ciis.test`, "Password123!");

  // Create
  const createRes = await client.request("/api/contacts", {
    method: "POST",
    body: JSON.stringify({
      name: "Alice Johnson",
      phone: "+15550199",
      email: "alice@example.com",
      company: "Acme Corp",
    }),
  });
  assert.equal(createRes.status, 201);
  const contactId = createRes.data.item.id;
  assert.ok(contactId);

  // Read
  const readRes = await client.request(`/api/contacts/${contactId}`);
  assert.equal(readRes.status, 200);
  assert.equal(readRes.data.item.name, "Alice Johnson");
  assert.equal(readRes.data.item.phone, "+15550199");

  // Update
  const updateRes = await client.request(`/api/contacts/${contactId}`, {
    method: "PATCH",
    body: JSON.stringify({
      company: "Acme International",
    }),
  });
  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.data.item.company, "Acme International");

  // Persistence check via List
  const listRes = await client.request("/api/contacts");
  assert.equal(listRes.status, 200);
  const found = listRes.data.contacts.find((c) => c.id === contactId);
  assert.ok(found);
  assert.equal(found.company, "Acme International");

  // Delete
  const deleteRes = await client.request(`/api/contacts/${contactId}`, {
    method: "DELETE",
  });
  assert.equal(deleteRes.status, 200);

  // Read after delete
  const readDeleted = await client.request(`/api/contacts/${contactId}`);
  assert.equal(readDeleted.status, 404);
});

test("4. Channel Security & Configuration-Required State", async () => {
  const client = new TestClient();
  const ts = Date.now();
  await client.signup("Channel Admin", `channel-${ts}@ciis.test`, "Password123!");

  // Attempt to submit fake connected states
  const fakeChannelPayload = {
    name: "Hacked WhatsApp Channel",
    phoneNumber: "+15551234567",
    phoneNumberId: "1234567890",
    wabaId: "9876543210",
    // Attacker tries to forge verified/connected status
    status: "connected",
    connectionStatus: "connected",
    connectionState: "connected",
    connected: true,
    health: "healthy",
    qualityRating: "GREEN",
    webhookStatus: "verified",
  };

  const createRes = await client.request("/api/channels", {
    method: "POST",
    body: JSON.stringify(fakeChannelPayload),
  });
  assert.equal(createRes.status, 201);
  const channel = createRes.data.item;

  // Verify backend strictly sanitized fake values and enforced configuration_required
  assert.equal(channel.status, "configuration_required", "Channel status must be configuration_required");
  assert.equal(channel.connectionState, "configuration_required");
  assert.equal(channel.connected, undefined, "Connected property must not be set");
  assert.equal(channel.qualityRating, undefined);
  assert.equal(channel.webhookStatus, "unknown");

  // Verify verification attempt with fake credentials fails gracefully
  const verifyRes = await client.request(`/api/channels/${channel.id}/verify`, {
    method: "POST",
  });
  assert.equal(verifyRes.status, 424, "Verification without real Meta credentials must return 424 Failed Dependency");
  assert.equal(verifyRes.data.ok, false);
});

test("5. Campaign Launch Safety & Server-Side Validation", async () => {
  const client = new TestClient();
  const ts = Date.now();
  await client.signup("Campaign User", `campaign-${ts}@ciis.test`, "Password123!");

  // 1. Create a channel (which remains in configuration_required)
  const channelRes = await client.request("/api/channels", {
    method: "POST",
    body: JSON.stringify({
      name: "Unverified WhatsApp",
      phoneNumber: "+15559876543",
    }),
  });
  const channelId = channelRes.data.item.id;

  // 2. Draft Campaign creation succeeds
  const draftRes = await client.request("/api/campaigns", {
    method: "POST",
    body: JSON.stringify({
      name: "Q4 Promo Draft",
      type: "single",
      status: "draft",
      channelId,
    }),
  });
  assert.equal(draftRes.status, 201);
  const campaignId = draftRes.data.campaign.id;
  assert.equal(draftRes.data.campaign.status, "draft");

  // 3. Attempting to Launch immediately fails server-side validation (channel not connected)
  const invalidLaunchRes = await client.request("/api/campaigns", {
    method: "POST",
    body: JSON.stringify({
      name: "Premature Launch",
      channelId,
      launchImmediately: true,
    }),
  });
  assert.equal(invalidLaunchRes.status, 409, "Must reject launch when channel is not connected");
  assert.match(invalidLaunchRes.data.error, /WhatsApp channel configuration is required/i);

  // 4. Starting draft campaign fails validation (empty audience or unconnected channel)
  const startRes = await client.request(`/api/campaigns/${campaignId}/start`, {
    method: "POST",
  });
  assert.ok([400, 409].includes(startRes.status), "Starting unconfigured draft must be rejected with 400 or 409");

  // 5. Campaign state lifecycle endpoints (pause, resume, stop)
  const pauseRes = await client.request(`/api/campaigns/${campaignId}/pause`, { method: "POST" });
  assert.ok([200, 400].includes(pauseRes.status));

  const resumeRes = await client.request(`/api/campaigns/${campaignId}/resume`, { method: "POST" });
  assert.ok([200, 400].includes(resumeRes.status));

  const stopRes = await client.request(`/api/campaigns/${campaignId}/stop`, { method: "POST" });
  assert.ok([200, 400].includes(stopRes.status));
});

test("6. Leads CRUD & Assignment", async () => {
  const client = new TestClient();
  const ts = Date.now();
  await client.signup("Lead Manager", `lead-${ts}@ciis.test`, "Password123!");

  // Create lead
  const createRes = await client.request("/api/leads", {
    method: "POST",
    body: JSON.stringify({
      title: "Enterprise Deal",
      value: 50000,
      status: "new",
      contactName: "Bob Smith",
      contactPhone: "+15554321",
    }),
  });
  assert.equal(createRes.status, 201);
  const leadId = createRes.data.item.id;

  // Update lead status and assignment
  const updateRes = await client.request(`/api/leads/${leadId}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "qualified",
      assignedTo: client.user.id,
    }),
  });
  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.data.item.status, "qualified");
});

test("7. RBAC Enforcement (Owner, Admin, Agent, Viewer)", async () => {
  const client = new TestClient();
  const ts = Date.now();
  await client.signup("Role Tester", `rbac-${ts}@ciis.test`, "Password123!");
  const userId = client.user.id;

  // 1. Owner: can create channels and contacts
  const ownerChannel = await client.request("/api/channels", {
    method: "POST",
    body: JSON.stringify({ name: "Owner Channel" }),
  });
  assert.equal(ownerChannel.status, 201, "Owner must be allowed to create channels");

  const ownerContact = await client.request("/api/contacts", {
    method: "POST",
    body: JSON.stringify({ name: "Owner Contact", phone: "+15551101" }),
  });
  assert.equal(ownerContact.status, 201, "Owner must be allowed to create contacts");

  // 2. Admin: can create channels and contacts
  await AccountMember.updateOne({ userId }, { $set: { role: "admin" } });
  const adminChannel = await client.request("/api/channels", {
    method: "POST",
    body: JSON.stringify({ name: "Admin Channel" }),
  });
  assert.equal(adminChannel.status, 201, "Admin must be allowed to create channels");

  const adminContact = await client.request("/api/contacts", {
    method: "POST",
    body: JSON.stringify({ name: "Admin Contact", phone: "+15551102" }),
  });
  assert.equal(adminContact.status, 201, "Admin must be allowed to create contacts");

  // 3. Agent: can create contacts, CANNOT create channels (admin required -> 403)
  await AccountMember.updateOne({ userId }, { $set: { role: "agent" } });
  const agentChannel = await client.request("/api/channels", {
    method: "POST",
    body: JSON.stringify({ name: "Agent Channel" }),
  });
  assert.equal(agentChannel.status, 403, "Agent must be forbidden from creating channels");
  assert.match(agentChannel.data.error, /requires 'admin' role or higher/i);

  const agentContact = await client.request("/api/contacts", {
    method: "POST",
    body: JSON.stringify({ name: "Agent Contact", phone: "+15551103" }),
  });
  assert.equal(agentContact.status, 201, "Agent must be allowed to create contacts");

  // 4. Viewer: CANNOT create contacts (agent required -> 403), CANNOT create channels (403), CAN read contacts
  await AccountMember.updateOne({ userId }, { $set: { role: "viewer" } });
  const viewerChannel = await client.request("/api/channels", {
    method: "POST",
    body: JSON.stringify({ name: "Viewer Channel" }),
  });
  assert.equal(viewerChannel.status, 403, "Viewer must be forbidden from creating channels");

  const viewerContactCreate = await client.request("/api/contacts", {
    method: "POST",
    body: JSON.stringify({ name: "Viewer Contact", phone: "+15551104" }),
  });
  assert.equal(viewerContactCreate.status, 403, "Viewer must be forbidden from creating contacts");
  assert.match(viewerContactCreate.data.error, /requires 'agent' role or higher/i);

  const viewerContactRead = await client.request("/api/contacts");
  assert.equal(viewerContactRead.status, 200, "Viewer must be allowed to read contacts");
});

test("8. Multi-Tenant Isolation (Account A vs Account B)", async () => {
  const clientA = new TestClient();
  const clientB = new TestClient();
  const ts = Date.now();

  await clientA.signup("Tenant A", `tenant-a-${ts}@ciis.test`, "Password123!");
  await clientB.signup("Tenant B", `tenant-b-${ts}@ciis.test`, "Password123!");

  // Tenant A creates Contact, Channel, Campaign
  const contactARes = await clientA.request("/api/contacts", {
    method: "POST",
    body: JSON.stringify({
      name: "Tenant A Contact",
      phone: "+15551111",
    }),
  });
  assert.equal(contactARes.status, 201);
  const contactAId = contactARes.data.item.id;

  const channelARes = await clientA.request("/api/channels", {
    method: "POST",
    body: JSON.stringify({
      name: "Tenant A Channel",
      phoneNumber: "+15552222",
    }),
  });
  assert.equal(channelARes.status, 201);
  const channelAId = channelARes.data.item.id;

  const campaignARes = await clientA.request("/api/campaigns", {
    method: "POST",
    body: JSON.stringify({
      name: "Tenant A Campaign",
    }),
  });
  assert.equal(campaignARes.status, 201);
  const campaignAId = campaignARes.data.campaign.id;

  // Tenant B cannot READ Tenant A's contact
  const readContactB = await clientB.request(`/api/contacts/${contactAId}`);
  assert.equal(readContactB.status, 404, "Tenant B must get 404 reading Tenant A contact");

  // Tenant B cannot MODIFY Tenant A's contact
  const updateContactB = await clientB.request(`/api/contacts/${contactAId}`, {
    method: "PATCH",
    body: JSON.stringify({ name: "Hacked by B" }),
  });
  assert.equal(updateContactB.status, 404, "Tenant B must get 404 modifying Tenant A contact");

  // Tenant B cannot DELETE Tenant A's contact
  const deleteContactB = await clientB.request(`/api/contacts/${contactAId}`, {
    method: "DELETE",
  });
  assert.equal(deleteContactB.status, 404, "Tenant B must get 404 deleting Tenant A contact");

  // Tenant B cannot READ Tenant A's channel
  const readChannelB = await clientB.request(`/api/channels/${channelAId}`);
  assert.equal(readChannelB.status, 404, "Tenant B must get 404 reading Tenant A channel");

  // Tenant B cannot READ Tenant A's campaign
  const readCampaignB = await clientB.request(`/api/campaigns/${campaignAId}`);
  assert.equal(readCampaignB.status, 404, "Tenant B must get 404 reading Tenant A campaign");

  // Tenant B's contacts list does not contain Tenant A's contact
  const listContactsB = await clientB.request("/api/contacts");
  const leakedContact = listContactsB.data.contacts.find((c) => c.id === contactAId);
  assert.equal(leakedContact, undefined, "Tenant B list must not include Tenant A contact");
});

test("9. API Security & Input Validation", async () => {
  const client = new TestClient();
  const ts = Date.now();
  await client.signup("Security Tester", `sec-${ts}@ciis.test`, "Password123!");

  // 1. Missing Authentication
  const noAuthClient = new TestClient();
  const noAuthRes = await noAuthClient.request("/api/contacts");
  assert.equal(noAuthRes.status, 401);

  // 2. Invalid Authentication token
  noAuthClient.cookie = "wacrm_session=invalid.bogus.jwt";
  const badAuthRes = await noAuthClient.request("/api/contacts");
  assert.equal(badAuthRes.status, 401);

  // 3. Invalid ObjectIds
  const invalidIdRes = await client.request("/api/contacts/not-an-object-id");
  assert.equal(invalidIdRes.status, 404);

  // 4. Missing required fields on Campaign creation
  const badCampaignRes = await client.request("/api/campaigns", {
    method: "POST",
    body: JSON.stringify({}),
  });
  assert.equal(badCampaignRes.status, 400);
  assert.match(badCampaignRes.data.error, /Campaign name is required/i);

  // 5. Nonexistent resource ID returns 404
  const randomHexId = "507f1f77bcf86cd799439011";
  const notFoundRes = await client.request(`/api/contacts/${randomHexId}`);
  assert.equal(notFoundRes.status, 404);
});

test("10. Chat & Conversations Lifecycle (Create, List, Assign, Status Update)", async () => {
  const client = new TestClient();
  const ts = Date.now();
  await client.signup("Chat Operator", `chat-${ts}@ciis.test`, "Password123!");

  // 1. Create a contact for conversation
  const contactRes = await client.request("/api/contacts", {
    method: "POST",
    body: JSON.stringify({
      name: "Chat Contact",
      phone: "+15557788",
    }),
  });
  assert.equal(contactRes.status, 201);
  const contactId = contactRes.data.item.id;

  // 2. Create conversation
  const convRes = await client.request("/api/v1/conversations", {
    method: "POST",
    body: JSON.stringify({
      contact_id: contactId,
      status: "open",
      channel: "whatsapp",
      unread_count: 1,
    }),
  });
  assert.equal(convRes.status, 201);
  const convId = convRes.data.item.id;

  // 3. List conversations
  const listRes = await client.request("/api/v1/conversations");
  assert.equal(listRes.status, 200);
  const foundConv = listRes.data.conversations.find((c) => c.id === convId);
  assert.ok(foundConv, "Conversation must exist in list");

  // 4. Update status to resolved and assign
  const updateRes = await client.request(`/api/v1/conversations/${convId}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "resolved",
      assigned_to: client.user.id,
    }),
  });
  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.data.item.status, "resolved");

  // 5. Read by ID to verify persistence
  const readRes = await client.request(`/api/v1/conversations/${convId}`);
  assert.equal(readRes.status, 200);
  assert.equal(readRes.data.item.status, "resolved");
});
