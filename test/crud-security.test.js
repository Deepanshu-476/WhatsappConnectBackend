import test from "node:test";
import assert from "node:assert/strict";

import { publicDoc, stripSecrets } from "../src/utils/crud.js";

test("publicDoc masks secrets in top-level and nested fields", () => {
  const doc = {
    _id: { toString: () => "channel-1" },
    name: "Production WhatsApp",
    accessToken: "EAAGlongproductiontoken1234",
    credentials: {
      webhook_secret: "super-secret-webhook",
      phoneNumberId: "1234567890",
    },
    fallback: [
      {
        api_key: "short",
        label: "secondary",
      },
    ],
  };

  const serialized = publicDoc(doc);

  assert.equal(serialized.id, "channel-1");
  assert.equal(serialized.name, "Production WhatsApp");
  assert.equal(serialized.accessToken, "EAA****************1234");
  assert.equal(serialized.credentials.webhook_secret, "sup****************hook");
  assert.equal(serialized.credentials.phoneNumberId, "1234567890");
  assert.equal(serialized.fallback[0].api_key, "****************");
  assert.equal(serialized.fallback[0].label, "secondary");
});

test("stripSecrets replaces secret values before audit logging", () => {
  const auditPayload = stripSecrets({
    displayName: "Main line",
    nested: {
      client_secret: "should-not-leak",
      untouched: "visible",
    },
  });

  assert.deepEqual(auditPayload, {
    displayName: "Main line",
    nested: {
      client_secret: "[redacted]",
      untouched: "visible",
    },
  });
});
