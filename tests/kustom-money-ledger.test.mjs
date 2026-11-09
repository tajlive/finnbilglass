import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canReserveFullMoneyOperation,
  providerConfirmsFullMovement
} from '../src/payments/kustom-money-ledger.ts';

const id = '48fa4f0f-b269-4b02-9e8c-71704199cc10';

const order = {
  id: 'ord_1234567890',
  payment_provider: 'kustom',
  kustom_order_id: id,
  amount_minor: 187375,
  status: 'PAYMENT_LINK_SENT',
  kustom_capture_state: 'AUTHORIZED',
  kustom_authorized_at: 1,
  paid_at: null,
  refunded_minor: 0
};

const op = {
  operation_id: '550e8400-e29b-41d4-a716-446655440000',
  payment_order_id: order.id,
  kustom_order_id: id,
  operation_type: 'capture',
  amount_minor: 187375,
  state: 'UNKNOWN'
};

const managed = {
  order_id: id,
  status: 'CAPTURED',
  fraud_status: 'ACCEPTED',
  original_order_amount: 187375,
  order_amount: 187375,
  captured_amount: 187375,
  refunded_amount: 0,
  remaining_authorized_amount: 0,
  purchase_currency: 'NOK'
};

test('capture requires authorized Kustom payment', () => {
  assert.equal(canReserveFullMoneyOperation(order,'capture'),true);
  assert.equal(canReserveFullMoneyOperation({
    ...order,payment_provider:'stripe'
  },'capture'),false);
});

test('refund requires previously captured payment', () => {
  assert.equal(canReserveFullMoneyOperation(order,'refund'),false);
  assert.equal(canReserveFullMoneyOperation({
    ...order,status:'PAID',
    kustom_capture_state:'PAID',paid_at:1
  },'refund'),true);
});

test('rejects already refunded payment', () => {
  assert.equal(canReserveFullMoneyOperation({
    ...order,status:'PAID',
    kustom_capture_state:'PAID',
    paid_at:1,refunded_minor:100
  },'refund'),false);
});

test('capture requires provider confirmation', () => {
  assert.equal(providerConfirmsFullMovement(managed,op),true);
  assert.equal(providerConfirmsFullMovement({
    ...managed,status:'AUTHORIZED',captured_amount:0
  },op),false);
});

test('refund requires correct full amount', () => {
  const refund = {...op,operation_type:'refund'};
  assert.equal(providerConfirmsFullMovement({
    ...managed,status:'CAPTURED',refunded_amount:187375
  },refund),true);
  assert.equal(providerConfirmsFullMovement({
    ...managed,status:'CAPTURED',refunded_amount:100
  },refund),false);
});

test('rejects manipulated order amount', () => {
  assert.equal(providerConfirmsFullMovement({
    ...managed,order_amount:187374
  },op),false);
});
