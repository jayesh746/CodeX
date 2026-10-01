const { customers, orders, policies } = require("./data");

/* Escalation limits: change these to match your company rules. */
const LIMITS = { highValueAmount: 10000, ticketCount: 3, minConfidence: 0.7 };

const HOLDING_MESSAGE = "Hi, thank you for your patience. We're sorry for the trouble. A senior team member is reviewing your case and will contact you personally today.";

const AGENT_IDS = ["intent", "history", "order", "policy", "root", "resolution", "escalation"];
const inr = n => "₹" + n.toLocaleString("en-IN");

/* 1. Intent */
function intentAgent({ complaint }) {
  const t = complaint.toLowerCase();
  const legal = /(lawyer|legal|court|\bsue\b|police|consumer forum)/.test(t);

  let type = "other", label = "General complaint";
  if (/(twice|double|two times|duplicate|charged again)/.test(t)) { type = "duplicate_payment"; label = "Duplicate payment"; }
  else if (/(fail|attempt)/.test(t)) { type = "delivery_failure"; label = "Repeated delivery failure"; }
  else if (/(late|delay|not (yet )?(arrived|come|delivered)|still has not|never arrived)/.test(t)) { type = "late_delivery"; label = "Late delivery"; }

  let sentiment = "Neutral";
  if (legal || /(worst|furious|unacceptable|nobody|fourth|third time)/.test(t) || (t.match(/!/g) || []).length >= 2) sentiment = "Very angry";
  else if (/(still|again|never|annoy|frustrat|not)/.test(t)) sentiment = "Frustrated";

  const urgency = legal || /(today|urgent|immediately)/.test(t) ? "High" : "Medium";

  return {
    summary: `${label}. Customer seems ${sentiment.toLowerCase()}.`,
    details: [`Issue type: ${label}`, `Sentiment: ${sentiment}`, `Urgency: ${urgency}`],
    data: { type, label, sentiment, urgency, legal }
  };
}

/* 2. Customer history */
function historyAgent({ customerId }) {
  const c = customers[customerId];
  if (!c) {
    return { summary: "Customer not found.", details: [`No record for ${customerId || "(empty ID)"}.`], flag: true, data: { found: false } };
  }
  const n = c.tickets.length;
  return {
    summary: `Customer for ${c.tenure}, ${n} earlier ticket(s).`,
    details: [`Name: ${c.name}`, `Lifetime spend: ${inr(c.lifetimeSpend)}`, ...c.tickets.map(t => `${t.id} (${t.status}): ${t.subject}`)],
    flag: n >= LIMITS.ticketCount,
    data: { found: true, ticketCount: n }
  };
}

/* 3. Order and payment */
function findOrder({ orderId, complaint }) {
  const id = (orderId || (complaint.match(/ORD-\d+/i) || [""])[0]).toUpperCase();
  return { id, order: orders[id] };
}

function orderAgent(input) {
  const { id, order } = findOrder(input);
  if (!order) {
    return { summary: "No matching order found.", details: [id ? `Order ${id} does not exist.` : "No order ID given."], flag: true, data: { found: false } };
  }
  const mismatch = order.customerId !== input.customerId;
  const okPayments = order.payments.filter(p => p.status === "success");
  const details = [`Order: ${id}`, `Status: ${order.status}`, `Days late: ${order.daysLate}`, `Failed delivery attempts: ${order.failedAttempts}`,
    `Successful payments: ${okPayments.length}`];
  if (mismatch) details.push("This order belongs to a different customer.");
  return {
    summary: `${inr(order.amount)} order. Status: ${order.status}.`,
    details,
    flag: mismatch || order.amount > LIMITS.highValueAmount,
    data: { found: true, id, mismatch }
  };
}

/* 4. Policy (keyword search, stand-in for RAG) */
function policyAgent(input, intent) {
  const t = input.complaint.toLowerCase();
  let best = null, bestScore = 0;
  for (const p of policies) {
    const score = p.keywords.filter(k => t.includes(k)).length + (p.intents.includes(intent.type) ? 3 : 0);
    if (score > bestScore) { best = p; bestScore = score; }
  }
  if (!best) return { summary: "No matching policy found.", details: ["Nothing in the policy library fits this complaint."], flag: true, data: { found: false } };
  return { summary: `Matched ${best.rule}.`, details: [best.text], data: { found: true, rule: best.rule } };
}

/* 5. Root cause */
function rootAgent(intent, order) {
  let code = "unknown", cause = "Cause could not be determined", confidence = 0.4;

  if (order) {
    const paid = order.payments.filter(p => p.status === "success");
    if (intent.type === "duplicate_payment" && paid.length > 1) {
      code = "duplicate_charge"; cause = "Payment gateway retry created a second charge"; confidence = 0.94;
    } else if (intent.type === "late_delivery" && order.daysLate > 0 && order.failedAttempts === 0) {
      code = "courier_delay"; cause = "Courier delay in transit"; confidence = 0.88;
    } else if (order.failedAttempts >= 2) {
      code = "unreachable_address"; cause = "Courier could not reach the address and it was never corrected"; confidence = 0.62;
    }
  }
  return {
    summary: cause + ".",
    details: [`Confidence: ${Math.round(confidence * 100)}%`],
    flag: confidence < LIMITS.minConfidence,
    data: { code, confidence }
  };
}

/* 6. Resolution */
function resolutionAgent(order, root) {
  let action, reply;
  if (!order) {
    action = "Ask the customer to confirm the order ID";
    reply = "Hi, sorry for the trouble. We could not find your order. Could you share your order ID so we can look into this right away?";
  } else if (root.code === "duplicate_charge") {
    const p = order.payments[0].amount;
    action = `Refund ${inr(p)} to the original payment method`;
    reply = `Hi, we're sorry about the double charge. We found the duplicate payment and started a refund of ${inr(p)} to your original payment method. It should appear in 5-7 working days.`;
  } else if (root.code === "courier_delay" && order.daysLate > 7) {
    action = `Cancel the order and refund ${inr(order.amount)}`;
    reply = `Hi, we apologise for the delay. Since your order is more than 7 days late, we've cancelled it and started a full refund of ${inr(order.amount)}. You'll see it within 5-7 working days.`;
  } else if (root.code === "courier_delay") {
    action = "Share an updated delivery date";
    reply = "Hi, sorry for the delay. Your order is still on its way and we have asked the courier to prioritise it. We'll update you within 24 hours.";
  } else if (root.code === "unreachable_address") {
    action = "Offer a full refund or priority re-ship, plus a goodwill credit";
    reply = "Hi, we're very sorry. A senior team member will contact you today to fix this personally.";
  } else {
    action = "Send to a human agent for manual review";
    reply = "Hi, thank you for telling us. A team member will review your case and get back to you shortly.";
  }
  return { summary: action + ".", details: ["The reply is shown in the final decision."], data: { action, reply } };
}

/* 7. Escalation: decide resolve vs. hand over to a human */
function escalationAgent(facts) {
  const { intent, history, order, orderRecord, policy, root, resolution } = facts;
  const reasons = [];
  if (intent.legal) reasons.push("Customer mentioned legal action.");
  if (intent.type === "other") reasons.push("Could not identify the type of issue.");
  if (!history.data.found) reasons.push("Customer record not found.");
  if (!order.data.found) reasons.push("No matching order found.");
  if (order.data.mismatch) reasons.push("Order belongs to a different customer. Possible account mix-up or fraud.");
  if (orderRecord && orderRecord.amount > LIMITS.highValueAmount) reasons.push(`High-value order (${inr(orderRecord.amount)}, limit ${inr(LIMITS.highValueAmount)}).`);
  if (history.data.ticketCount >= LIMITS.ticketCount) reasons.push(`${history.data.ticketCount} tickets already raised by this customer.`);
  if (!policy.data.found) reasons.push("No policy covers this case.");
  if (root.data.confidence < LIMITS.minConfidence) reasons.push(`Root cause confidence is only ${Math.round(root.data.confidence * 100)}%.`);

  const escalate = reasons.length > 0;
  return {
    summary: escalate ? `Needs a human: ${reasons.length} risk signal(s) found.` : "No risk signals. Safe to resolve automatically.",
    details: escalate ? reasons : ["Amount, history, tone and confidence are all within limits."],
    flag: escalate,
    data: { escalate, reasons, action: resolution.data.action, reply: escalate ? HOLDING_MESSAGE : resolution.data.reply }
  };
}

/* Run all agents in order and return every result. */
function investigate(input) {
  const { order: orderRecord } = findOrder(input);
  const intent = intentAgent(input);
  const history = historyAgent(input);
  const order = orderAgent(input);
  const policy = policyAgent(input, intent.data);
  const root = rootAgent(intent.data, orderRecord);
  const resolution = resolutionAgent(orderRecord, root.data);
  const escalation = escalationAgent({ intent: intent.data, history, order, orderRecord, policy, root, resolution });
  return { intent, history, order, policy, root, resolution, escalation };
}

module.exports = { investigate, AGENT_IDS };
