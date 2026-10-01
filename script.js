
const SCENARIOS = {
  double: {
    customer: "CUS-10482",
    order: "ORD-77213",
    text: "I was charged twice for my order ORD-77213. The money left my account two times but I only ordered once. Please refund the extra payment.",
    intent: { type: "Duplicate payment", sentiment: "Frustrated", urgency: "Medium" },
    history: { tenure: "3 years", tickets: 1, spend: 48200, note: "1 earlier ticket, closed happily" },
    order_info: { amount: 2499, status: "Delivered", payments: "2 successful charges of ₹2,499 within 40 seconds" },
    policy: { rule: "Refund Policy 4.2", text: "Duplicate charges are refunded in full within 5–7 working days." },
    root: { cause: "Payment gateway retry created a second charge", confidence: 0.94 },
    resolution: {
      action: "Refund ₹2,499 to the original payment method",
      reply: "Hi, we're sorry about the double charge. We found the duplicate payment and started a refund of ₹2,499 to your original payment method. It should appear in 5–7 working days."
    },
    flags: {}
  },
  late: {
    customer: "CUS-20931",
    order: "ORD-80455",
    text: "My order was supposed to arrive last week and it still has not come. I want my money back, I no longer need it.",
    intent: { type: "Late delivery, refund request", sentiment: "Annoyed", urgency: "Medium" },
    history: { tenure: "1 year", tickets: 0, spend: 12900, note: "No earlier tickets" },
    order_info: { amount: 3799, status: "In transit, 8 days past promised date", payments: "1 successful charge" },
    policy: { rule: "Delivery Policy 2.1", text: "Orders delayed by more than 7 days qualify for a full refund or free re-ship." },
    root: { cause: "Courier hub delay in the customer's region", confidence: 0.88 },
    resolution: {
      action: "Cancel the order and refund ₹3,799",
      reply: "Hi, we apologise for the delay. Since your order is more than 7 days late, we've cancelled it and started a full refund of ₹3,799. You'll see it within 5–7 working days."
    },
    flags: {}
  },
  legal: {
    customer: "CUS-30077",
    order: "ORD-65120",
    text: "This is the fourth time my delivery has failed and nobody has fixed it. I paid ₹24,000 and I am going to approach a consumer court and my lawyer if this is not solved today.",
    intent: { type: "Repeated delivery failure", sentiment: "Very angry", urgency: "High" },
    history: { tenure: "5 years", tickets: 4, spend: 215000, note: "4 open or recently reopened tickets on the same order" },
    order_info: { amount: 24000, status: "4 failed delivery attempts", payments: "1 successful charge" },
    policy: { rule: "Escalation Policy 7.3", text: "Legal threats and orders above ₹10,000 with repeated failures need a human case owner." },
    root: { cause: "Address flagged as unreachable by courier, never corrected", confidence: 0.62 },
    resolution: {
      action: "Offer a full refund or priority re-ship, with a goodwill credit",
      reply: "Hi, we're very sorry. A senior team member will contact you today to fix this personally."
    },
    flags: { legal: true }
  }
};

/* Pick a scenario for free-text complaints (simple keyword match). */
function detectScenario(text) {
  const t = text.toLowerCase();
  if (/(lawyer|legal|court|sue|police)/.test(t)) return "legal";
  if (/(twice|double|two times|charged again|duplicate)/.test(t)) return "double";
  return "late";
}

/* ---------- The seven agents, in order ---------- */

const money = n => "₹" + n.toLocaleString("en-IN");

const AGENTS = [
  {
    id: "intent", name: "Intent agent",
    run: s => ({
      summary: `${s.intent.type}. Customer seems ${s.intent.sentiment.toLowerCase()}.`,
      details: [`Issue type: ${s.intent.type}`, `Sentiment: ${s.intent.sentiment}`, `Urgency: ${s.intent.urgency}`]
    })
  },
  {
    id: "history", name: "Customer history agent",
    run: s => ({
      summary: `Customer for ${s.history.tenure}, ${s.history.tickets} earlier ticket(s).`,
      details: [`Lifetime spend: ${money(s.history.spend)}`, s.history.note],
      flag: s.history.tickets >= 3
    })
  },
  {
    id: "order", name: "Order and payment agent",
    run: s => ({
      summary: `${money(s.order_info.amount)} order. Status: ${s.order_info.status}.`,
      details: [`Order: ${s.order}`, `Payments: ${s.order_info.payments}`],
      flag: s.order_info.amount > 10000
    })
  },
  {
    id: "policy", name: "Policy agent (RAG)",
    run: s => ({
      summary: `Matched ${s.policy.rule}.`,
      details: [s.policy.text]
    })
  },
  {
    id: "root", name: "Root cause agent",
    run: s => ({
      summary: s.root.cause + ".",
      details: [`Confidence: ${Math.round(s.root.confidence * 100)}%`],
      flag: s.root.confidence < 0.7
    })
  },
  {
    id: "resolution", name: "Resolution agent",
    run: s => ({
      summary: s.resolution.action + ".",
      details: ["Draft reply is shown in the final decision."]
    })
  },
  {
    id: "escalation", name: "Escalation agent",
    run: s => {
      const reasons = escalationReasons(s);
      return {
        summary: reasons.length ? "Needs a human: " + reasons.length + " risk signal(s) found." : "No risk signals. Safe to resolve automatically.",
        details: reasons.length ? reasons : ["Amount, history, tone and confidence are all within limits."],
        flag: reasons.length > 0
      };
    }
  }
];

/* The key challenge: when to resolve vs. when to hand over to a human. */
function escalationReasons(s) {
  const r = [];
  if (s.flags.legal) r.push("Customer mentioned legal action.");
  if (s.order_info.amount > 10000) r.push(`High-value order (${money(s.order_info.amount)}, limit ${money(10000)}).`);
  if (s.history.tickets >= 3) r.push(`${s.history.tickets} tickets already raised for this customer.`);
  if (s.root.confidence < 0.7) r.push(`Root cause confidence is only ${Math.round(s.root.confidence * 100)}%.`);
  return r;
}

/*
  Replace this with a real API call, for example:
    const res = await fetch("/api/agents/" + agent.id, { method: "POST", body: JSON.stringify(payload) });
    return res.json();   // must return { summary, details: [], flag: boolean }
*/
async function runAgent(agent, scenario) {
  await new Promise(r => setTimeout(r, 700));
  return agent.run(scenario);
}

/* ---------- UI ---------- */

const $ = id => document.getElementById(id);
const form = $("complaint-form");
const pipelineEl = $("pipeline");
const decisionEl = $("decision");

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text; // textContent keeps user text safe
  return node;
}

document.querySelectorAll(".chip").forEach(btn => {
  btn.addEventListener("click", () => {
    const s = SCENARIOS[btn.dataset.sample];
    $("customer-id").value = s.customer;
    $("order-id").value = s.order;
    $("complaint").value = s.text;
  });
});

function buildPipeline() {
  pipelineEl.replaceChildren();
  AGENTS.forEach((agent, i) => {
    const li = el("li", "step pending");
    li.id = "step-" + agent.id;
    li.append(el("span", "badge", String(i + 1)));
    const head = el("div", "step-head");
    head.append(el("span", "step-name", agent.name), el("span", "step-status", "Waiting"));
    li.append(head, el("p", "step-summary", ""));
    pipelineEl.append(li);
  });
  $("empty").hidden = true;
  pipelineEl.hidden = false;
}

function updateStep(agent, state, result) {
  const li = $("step-" + agent.id);
  li.className = "step " + state;
  li.querySelector(".step-status").textContent =
    state === "running" ? "Working..." : state === "flag" ? "Needs attention" : state === "done" ? "Done" : "Waiting";
  if (result) {
    li.querySelector(".step-summary").textContent = result.summary;
    const d = el("details");
    d.append(el("summary", "", "See details"));
    const ul = el("ul");
    result.details.forEach(t => ul.append(el("li", "", t)));
    d.append(ul);
    li.append(d);
  }
}

function showDecision(s, customerText) {
  const reasons = escalationReasons(s);
  const escalate = reasons.length > 0;
  decisionEl.className = "panel decision " + (escalate ? "escalate" : "resolve");
  const body = $("decision-body");
  body.replaceChildren();

  body.append(el("div", "verdict", escalate ? "Escalate to a human agent" : "Resolved automatically"));
  body.append(el("p", "", escalate
    ? "This case has risk signals that an AI should not decide alone."
    : "The agent is confident and the case is within safe limits."));

  body.append(el("h3", "", "Recommended action"));
  body.append(el("p", "", s.resolution.action));

  if (escalate) {
    body.append(el("h3", "", "Why it is being escalated"));
    const ul = el("ul");
    reasons.forEach(r => ul.append(el("li", "", r)));
    body.append(ul);
  }

  body.append(el("h3", "", escalate ? "Holding message for the customer" : "Reply to send to the customer"));
  body.append(el("div", "reply", s.resolution.reply));

  const actions = el("div", "actions");
  const primary = el("button", "", escalate ? "Assign to human agent" : "Send reply and close ticket");
  primary.type = "button";
  primary.addEventListener("click", () => {
    primary.textContent = escalate ? "Assigned to the support team" : "Reply sent, ticket closed";
    primary.disabled = true;
  });
  actions.append(primary);
  body.append(actions);

  decisionEl.hidden = false;
  decisionEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

form.addEventListener("submit", async e => {
  e.preventDefault();
  const btn = $("run-btn");
  btn.disabled = true;
  btn.textContent = "Investigating...";
  decisionEl.hidden = true;

  const text = $("complaint").value.trim();
  const scenario = SCENARIOS[detectScenario(text)];
  buildPipeline();

  for (const agent of AGENTS) {
    updateStep(agent, "running");
    const result = await runAgent(agent, scenario);
    updateStep(agent, result.flag ? "flag" : "done", result);
  }

  showDecision(scenario, text);
  btn.disabled = false;
  btn.textContent = "Investigate complaint";
});
