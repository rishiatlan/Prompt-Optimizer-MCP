#!/bin/bash
# razorpay-setup.sh — Create Razorpay subscription plans + links for Prompt Control Plane
#
# Usage:
#   export RZP_KEY_ID="rzp_test_xxxxx"    # or rzp_live_xxxxx for production
#   export RZP_KEY_SECRET="yyyyy"
#   bash scripts/razorpay-setup.sh
#
# This script:
#   1. Creates two Plans (Pro ₹499/mo, Power ₹899/mo)
#   2. Creates Subscription Links for each plan
#   3. Outputs the payment URLs to wire into src/tools.ts
#
# Prerequisites: curl, jq

set -euo pipefail

# ─── Validate env vars ───────────────────────────────────────────────────────

if [[ -z "${RZP_KEY_ID:-}" || -z "${RZP_KEY_SECRET:-}" ]]; then
  echo "❌ Set RZP_KEY_ID and RZP_KEY_SECRET first:"
  echo "   export RZP_KEY_ID='rzp_test_xxxxx'"
  echo "   export RZP_KEY_SECRET='your_secret'"
  exit 1
fi

BASE="https://api.razorpay.com/v1"
AUTH="${RZP_KEY_ID}:${RZP_KEY_SECRET}"

echo "🔧 Using Razorpay key: ${RZP_KEY_ID}"
echo ""

# ─── Step 1: Create Plans ────────────────────────────────────────────────────

echo "━━━ Step 1: Creating Plans ━━━"

PRO_PLAN=$(curl -s -u "$AUTH" \
  -H "Content-Type: application/json" \
  -X POST "$BASE/plans" \
  -d '{
    "period": "monthly",
    "interval": 1,
    "item": {
      "name": "Prompt Control Plane Pro",
      "amount": 49900,
      "currency": "INR",
      "description": "100 optimizations/month, 30 req/min rate limit, offline license key. All 15 tools."
    }
  }')

PRO_PLAN_ID=$(echo "$PRO_PLAN" | jq -r '.id')
if [[ "$PRO_PLAN_ID" == "null" || -z "$PRO_PLAN_ID" ]]; then
  echo "❌ Failed to create Pro plan:"
  echo "$PRO_PLAN" | jq .
  exit 1
fi
echo "✅ Pro Plan created: $PRO_PLAN_ID (₹499/mo)"

POWER_PLAN=$(curl -s -u "$AUTH" \
  -H "Content-Type: application/json" \
  -X POST "$BASE/plans" \
  -d '{
    "period": "monthly",
    "interval": 1,
    "item": {
      "name": "Prompt Control Plane Power",
      "amount": 89900,
      "currency": "INR",
      "description": "Unlimited optimizations, 60 req/min, always-on mode, priority support. All 15 tools."
    }
  }')

POWER_PLAN_ID=$(echo "$POWER_PLAN" | jq -r '.id')
if [[ "$POWER_PLAN_ID" == "null" || -z "$POWER_PLAN_ID" ]]; then
  echo "❌ Failed to create Power plan:"
  echo "$POWER_PLAN" | jq .
  exit 1
fi
echo "✅ Power Plan created: $POWER_PLAN_ID (₹899/mo)"
echo ""

# ─── Step 2: Create Subscription Links ───────────────────────────────────────

echo "━━━ Step 2: Creating Subscription Links ━━━"

PRO_SUB=$(curl -s -u "$AUTH" \
  -H "Content-Type: application/json" \
  -X POST "$BASE/subscriptions" \
  -d "{
    \"plan_id\": \"$PRO_PLAN_ID\",
    \"total_count\": 120,
    \"quantity\": 1,
    \"customer_notify\": 1,
    \"notes\": {
      \"product\": \"prompt-control-plane\",
      \"tier\": \"pro\"
    }
  }")

PRO_SUB_ID=$(echo "$PRO_SUB" | jq -r '.id')
PRO_SHORT_URL=$(echo "$PRO_SUB" | jq -r '.short_url')
if [[ "$PRO_SUB_ID" == "null" || -z "$PRO_SUB_ID" ]]; then
  echo "❌ Failed to create Pro subscription:"
  echo "$PRO_SUB" | jq .
  exit 1
fi
echo "✅ Pro Subscription: $PRO_SUB_ID"
echo "   URL: $PRO_SHORT_URL"

POWER_SUB=$(curl -s -u "$AUTH" \
  -H "Content-Type: application/json" \
  -X POST "$BASE/subscriptions" \
  -d "{
    \"plan_id\": \"$POWER_PLAN_ID\",
    \"total_count\": 120,
    \"quantity\": 1,
    \"customer_notify\": 1,
    \"notes\": {
      \"product\": \"prompt-control-plane\",
      \"tier\": \"power\"
    }
  }")

POWER_SUB_ID=$(echo "$POWER_SUB" | jq -r '.id')
POWER_SHORT_URL=$(echo "$POWER_SUB" | jq -r '.short_url')
if [[ "$POWER_SUB_ID" == "null" || -z "$POWER_SUB_ID" ]]; then
  echo "❌ Failed to create Power subscription:"
  echo "$POWER_SUB" | jq .
  exit 1
fi
echo "✅ Power Subscription: $POWER_SUB_ID"
echo "   URL: $POWER_SHORT_URL"
echo ""

# ─── Step 3: Output ──────────────────────────────────────────────────────────

echo "━━━ Done! Wire these into the codebase ━━━"
echo ""
echo "In src/tools.ts, replace the TODO URLs with:"
echo ""
echo "  export const PRO_PURCHASE_URL = '$PRO_SHORT_URL';"
echo "  export const POWER_PURCHASE_URL = '$POWER_SHORT_URL';"
echo ""
echo "In docs/index.html, update the button hrefs:"
echo ""
echo "  Pro button:   $PRO_SHORT_URL"
echo "  Power button: $POWER_SHORT_URL"
echo ""
echo "Plan IDs (save for reference):"
echo "  Pro:   $PRO_PLAN_ID"
echo "  Power: $POWER_PLAN_ID"
echo ""
echo "Subscription IDs:"
echo "  Pro:   $PRO_SUB_ID"
echo "  Power: $POWER_SUB_ID"
