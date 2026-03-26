// Point of Origin Coffee — Main JS

// Mobile menu toggle
document.addEventListener('DOMContentLoaded', function () {
  const toggle = document.querySelector('.mobile-menu-toggle');
  const header = document.querySelector('.site-header');

  if (toggle && header) {
    toggle.addEventListener('click', function () {
      header.classList.toggle('menu-open');
    });
  }

  // FAQ accordion
  const faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach(function (item) {
    const question = item.querySelector('.faq-question');
    if (question) {
      question.addEventListener('click', function () {
        const wasActive = item.classList.contains('active');
        // Close all
        faqItems.forEach(function (i) { i.classList.remove('active'); });
        // Toggle current
        if (!wasActive) {
          item.classList.add('active');
        }
      });
    }
  });

  // Smooth scroll for anchor links
  document.querySelectorAll('a[href^="#"]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        e.preventDefault();
        // Close mobile menu if open
        if (header) header.classList.remove('menu-open');
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
});
