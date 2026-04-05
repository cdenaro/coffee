// Point of Origin Coffee — Cart System

var Cart = (function () {
  var STORAGE_KEY = 'poc_cart';

  function getItems() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  function saveItems(items) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    updateCartCount();
  }

  function addItem(name, price, quantity) {
    var items = getItems();
    var existing = null;
    for (var i = 0; i < items.length; i++) {
      if (items[i].name === name) {
        existing = items[i];
        break;
      }
    }
    if (existing) {
      existing.quantity += (quantity || 1);
    } else {
      items.push({ name: name, price: price, quantity: quantity || 1 });
    }
    saveItems(items);
    showNotification(name + ' added to cart');
  }

  function removeItem(name) {
    var items = getItems();
    items = items.filter(function (item) { return item.name !== name; });
    saveItems(items);
  }

  function updateQuantity(name, quantity) {
    var items = getItems();
    for (var i = 0; i < items.length; i++) {
      if (items[i].name === name) {
        if (quantity <= 0) {
          items.splice(i, 1);
        } else {
          items[i].quantity = quantity;
        }
        break;
      }
    }
    saveItems(items);
  }

  function getTotal() {
    var items = getItems();
    var total = 0;
    for (var i = 0; i < items.length; i++) {
      total += items[i].price * items[i].quantity;
    }
    return total;
  }

  function getCount() {
    var items = getItems();
    var count = 0;
    for (var i = 0; i < items.length; i++) {
      count += items[i].quantity;
    }
    return count;
  }

  function clear() {
    localStorage.removeItem(STORAGE_KEY);
    updateCartCount();
  }

  function updateCartCount() {
    var badges = document.querySelectorAll('.cart-count');
    var count = getCount();
    badges.forEach(function (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? 'inline-flex' : 'none';
    });
  }

  function showNotification(message) {
    var existing = document.querySelector('.cart-notification');
    if (existing) existing.remove();

    var el = document.createElement('div');
    el.className = 'cart-notification';
    el.innerHTML = '<span>' + message + '</span><a href="checkout.html">View Cart &rarr;</a>';
    document.body.appendChild(el);

    setTimeout(function () { el.classList.add('visible'); }, 10);
    setTimeout(function () {
      el.classList.remove('visible');
      setTimeout(function () { el.remove(); }, 300);
    }, 3000);
  }

  function formatOrderSummary() {
    var items = getItems();
    var lines = [];
    for (var i = 0; i < items.length; i++) {
      lines.push(items[i].quantity + 'x ' + items[i].name + ' — $' + (items[i].price * items[i].quantity).toFixed(2));
    }
    lines.push('');
    lines.push('Total: $' + getTotal().toFixed(2));
    return lines.join('\n');
  }

  // Initialize cart count on page load
  document.addEventListener('DOMContentLoaded', function () {
    updateCartCount();

    // Attach click handlers to all add-to-cart buttons
    document.querySelectorAll('[data-add-to-cart]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var name = this.getAttribute('data-product-name');
        var price = parseFloat(this.getAttribute('data-product-price'));
        if (name && price) {
          addItem(name, price, 1);
        }
      });
    });
  });

  return {
    getItems: getItems,
    addItem: addItem,
    removeItem: removeItem,
    updateQuantity: updateQuantity,
    getTotal: getTotal,
    getCount: getCount,
    clear: clear,
    updateCartCount: updateCartCount,
    formatOrderSummary: formatOrderSummary
  };
})();
