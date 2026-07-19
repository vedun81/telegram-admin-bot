// Після того, як відняли гроші та додали предмет
if (typeof logPurchase === 'function') {
  logPurchase(SHOP_NAMES[item] || item, finalPrice, user.points);
}
if (typeof logItemPurchase === 'function') {
  logItemPurchase(item, finalPrice);
}
