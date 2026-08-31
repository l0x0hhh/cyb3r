/* 用户端点击粒子特效：只由借还页面按需初始化，并在页面卸载时释放监听和动画。 */
(function (window, document) {
  'use strict';

  window.initBorrowFireworks = function initBorrowFireworks(canvasEl) {
    if (!canvasEl || typeof window.anime !== 'function') return function () {};
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return function () {};
    }

    var ctx = canvasEl.getContext('2d');
    var numberOfParticules = 30;
    var pointerX = 0;
    var pointerY = 0;
    var colors = ['#FF1461', '#18FF92', '#5A87FF', '#FBF38C'];
    var activeAnimations = [];
    var resizeTimer = null;
    var canvasRatio = 1;
    var canvasWidth = 0;
    var canvasHeight = 0;

    function updateCoords(event) {
      var rect = canvasEl.getBoundingClientRect();
      var touch = event.touches && event.touches[0];
      var clientX = event.clientX != null ? event.clientX : touch ? touch.clientX : 0;
      var clientY = event.clientY != null ? event.clientY : touch ? touch.clientY : 0;
      pointerX = clientX - rect.left;
      pointerY = clientY - rect.top;
    }

    function setParticuleDirection(particule) {
      var angle = window.anime.random(0, 360) * Math.PI / 180;
      var distance = window.anime.random(35, 130);
      var direction = [-1, 1][window.anime.random(0, 1)] * distance;
      return {
        x: particule.x + direction * Math.cos(angle),
        y: particule.y + direction * Math.sin(angle)
      };
    }

    function createParticule(x, y) {
      var particule = {
        x: x,
        y: y,
        color: colors[window.anime.random(0, colors.length - 1)],
        radius: window.anime.random(11.2, 22.4)
      };
      particule.endPos = setParticuleDirection(particule);
      particule.draw = function () {
        ctx.beginPath();
        ctx.arc(particule.x, particule.y, particule.radius, 0, 2 * Math.PI, true);
        ctx.fillStyle = particule.color;
        ctx.fill();
      };
      return particule;
    }

    function createCircle(x, y, particleColors) {
      var colorCounts = {};
      particleColors.forEach(function (color) {
        colorCounts[color] = (colorCounts[color] || 0) + 1;
      });
      var minColor = Object.keys(colorCounts).reduce(function (left, right) {
        return colorCounts[left] < colorCounts[right] ? left : right;
      });
      var circle = { x: x, y: y, radius: 0.1, alpha: 0.5, lineWidth: 6 };
      circle.draw = function () {
        ctx.globalAlpha = circle.alpha;
        ctx.beginPath();
        ctx.arc(circle.x, circle.y, circle.radius, 0, 2 * Math.PI, true);
        ctx.lineWidth = circle.lineWidth;
        ctx.strokeStyle = minColor;
        ctx.stroke();
        ctx.globalAlpha = 1;
      };
      return circle;
    }

    function renderParticule(animation) {
      for (var index = 0; index < animation.animatables.length; index += 1) {
        animation.animatables[index].target.draw();
      }
    }

    function animateParticules(x, y) {
      var particleColors = [];
      var particules = [];
      for (var index = 0; index < numberOfParticules; index += 1) {
        var particule = createParticule(x, y);
        particules.push(particule);
        particleColors.push(particule.color);
      }
      var circle = createCircle(x, y, particleColors);
      var timeline = window.anime.timeline({
        complete: function () {
          var position = activeAnimations.indexOf(timeline);
          if (position !== -1) activeAnimations.splice(position, 1);
        }
      });
      activeAnimations.push(timeline);
      timeline.add({
        targets: particules,
        x: function (particule) { return particule.endPos.x; },
        y: function (particule) { return particule.endPos.y; },
        radius: 0.1,
        duration: window.anime.random(1200, 1800),
        easing: 'easeOutExpo',
        update: renderParticule
      }).add({
        targets: circle,
        radius: window.anime.random(80, 160) * 0.5,
        lineWidth: 0,
        alpha: { value: 0, easing: 'linear', duration: window.anime.random(600, 800) },
        duration: window.anime.random(1200, 1800),
        easing: 'easeOutExpo',
        update: renderParticule,
        offset: 0
      });
    }

    function resizeCanvas() {
      canvasRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvasWidth = window.innerWidth;
      canvasHeight = window.innerHeight;
      canvasEl.width = Math.floor(canvasWidth * canvasRatio);
      canvasEl.height = Math.floor(canvasHeight * canvasRatio);
      canvasEl.style.width = canvasWidth + 'px';
      canvasEl.style.height = canvasHeight + 'px';
      ctx.setTransform(canvasRatio, 0, 0, canvasRatio, 0, 0);
    }

    function scheduleResize() {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resizeCanvas, 150);
    }

    function isIgnoredTarget(target) {
      return target && target.closest && target.closest(
        'a, button, input, textarea, select, option, label, [role="button"], [contenteditable="true"], .modal, .modal-overlay, [data-fireworks-ignore]'
      );
    }

    function handlePointerDown(event) {
      if (event.isPrimary === false || isIgnoredTarget(event.target)) return;
      updateCoords(event);
      render.play();
      animateParticules(pointerX, pointerY);
    }

    resizeCanvas();
    var render = window.anime({
      duration: Infinity,
      autoplay: false,
      update: function () {
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);
      }
    });
    document.addEventListener('pointerdown', handlePointerDown, { passive: true });
    window.addEventListener('resize', scheduleResize, { passive: true });

    return function destroyBorrowFireworks() {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', scheduleResize);
      window.clearTimeout(resizeTimer);
      render.pause();
      activeAnimations.forEach(function (animation) { animation.pause(); });
      activeAnimations.length = 0;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    };
  };
}(window, document));
