/*
  Sample data. Replace these lookups with your real database / CRM / payment API.
  The shapes below are what agents.js expects.
*/

const customers = {
  "CUS-10482": {
    name: "Asha Verma", tenure: "3 years", lifetimeSpend: 48200,
    tickets: [{ id: "TKT-501", status: "closed", subject: "Coupon not applied" }]
  },
  "CUS-20931": {
    name: "Rohan Deshmukh", tenure: "1 year", lifetimeSpend: 12900,
    tickets: []
  },
  "CUS-30077": {
    name: "Meera Kulkarni", tenure: "5 years", lifetimeSpend: 215000,
    tickets: [
      { id: "TKT-812", status: "open", subject: "Delivery failed" },
      { id: "TKT-840", status: "reopened", subject: "Delivery failed again" },
      { id: "TKT-877", status: "open", subject: "No update on delivery" },
      { id: "TKT-902", status: "open", subject: "Delivery failed, 4th attempt" }
    ]
  }
};

const orders = {
  "ORD-77213": {
    customerId: "CUS-10482", amount: 2499, status: "Delivered",
    daysLate: 0, failedAttempts: 0,
    payments: [
      { id: "PAY-1", amount: 2499, status: "success", secondsFromFirst: 0 },
      { id: "PAY-2", amount: 2499, status: "success", secondsFromFirst: 40 }
    ]
  },
  "ORD-80455": {
    customerId: "CUS-20931", amount: 3799, status: "In transit",
    daysLate: 8, failedAttempts: 0,
    payments: [{ id: "PAY-3", amount: 3799, status: "success", secondsFromFirst: 0 }]
  },
  "ORD-65120": {
    customerId: "CUS-30077", amount: 24000, status: "Delivery failed",
    daysLate: 12, failedAttempts: 4,
    payments: [{ id: "PAY-4", amount: 24000, status: "success", secondsFromFirst: 0 }]
  }
};

/* Company policy snippets. agents.js picks the best match (a simple stand-in for RAG). */
const policies = [
  {
    rule: "Refund Policy 4.2", intents: ["duplicate_payment"],
    keywords: ["duplicate", "twice", "double", "charged", "refund", "payment"],
    text: "Duplicate charges are refunded in full within 5-7 working days."
  },
  {
    rule: "Delivery Policy 2.1", intents: ["late_delivery"],
    keywords: ["late", "delay", "arrived", "delivery", "refund", "transit"],
    text: "Orders delayed by more than 7 days qualify for a full refund or a free re-ship."
  },
  {
    rule: "Escalation Policy 7.3", intents: ["delivery_failure"],
    keywords: ["failed", "fail", "attempt", "legal", "lawyer", "court", "again"],
    text: "Legal threats, and high-value orders with repeated delivery failures, need a human case owner."
  }
];

module.exports = { customers, orders, policies };
