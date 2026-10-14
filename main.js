(function(){
  "use strict";

  // 1920x1080, 10.04s, 241 frames, all-intra: every frame is a keyframe, so a
  // scroll scrub can land on any exact frame instantly with no GOP decode cost.
  var VIDEO_URL = "https://d2ol7oe51mr4n9.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/45567745-d826-44a2-a5ce-7ef670944e60.mp4";

  var clip = document.getElementById("clip");
  var boot = document.getElementById("boot");
  var bootBar = document.getElementById("bootBar");
  var bootPct = document.getElementById("bootPct");
  var meter = document.getElementById("meter");
  var panels = [].slice.call(document.querySelectorAll("[data-panel]"));

  // [fadeInStart, fadeInEnd, fadeOutStart, fadeOutEnd] in 0..1 page progress.
  // The gaps between one panel's fadeOutEnd and the next's fadeInStart are
  // deliberate dead zones (video only) so two panels are never readable at once.
  var CUES = [
    [0.00, 0.00, 0.15, 0.23],
    [0.35, 0.43, 0.57, 0.65],
    [0.77, 0.85, 1.10, 1.20]
  ];
  var DRIFT = 22; // px of counter-scroll travel per panel

  function clamp(v, a, b){ return Math.min(b, Math.max(a, v)); }
  function smooth(t){ return t * t * (3 - 2 * t); }
  function ramp(p, a, b){
    if (b <= a) return p >= b ? 1 : 0;
    return smooth(clamp((p - a) / (b - a), 0, 1));
  }

  var progress = 0, seekTo = 0, seekAt = 0, duration = 0, ready = false;

  function readScroll(){
    var max = document.documentElement.scrollHeight - window.innerHeight;
    progress = max > 0 ? clamp(window.pageYOffset / max, 0, 1) : 0;
    if (duration) seekTo = progress * duration;
  }

  function paint(){
    meter.style.transform = "scaleX(" + progress + ")";
    for (var i = 0; i < panels.length; i++){
      var c = CUES[i], el = panels[i];
      var enter = ramp(progress, c[0], c[1]);
      var leave = ramp(progress, c[2], c[3]);
      var o = enter * (1 - leave);
      var y = (1 - enter) * DRIFT - leave * DRIFT;
      el.style.opacity = o;
      el.style.transform = "translate3d(0," + y + "px,0)";
      el.style.pointerEvents = o > 0.6 ? "auto" : "none";
    }
  }

  function frame(){
    if (ready && duration){
      var gap = seekTo - seekAt;
      if (Math.abs(gap) > 0.0008){
        seekAt += gap * 0.115; // easing factor — do not change
        if (clip.readyState >= 2 && !clip.seeking){
          try { clip.currentTime = seekAt; } catch (e) {}
        }
      }
    }
    paint();
    requestAnimationFrame(frame);
  }

  function setProgress(f){
    bootBar.style.transform = "scaleX(" + f + ")";
    bootPct.textContent = "LOADING " + Math.round(f * 100) + "%";
  }

  var started = false;
  function start(){
    if (started) return;
    started = true;
    ready = true;
    boot.classList.add("done");
    readScroll();
    seekAt = seekTo;
  }

  var attached = false;
  function attach(src){
    if (attached) return;
    attached = true;
    clip.addEventListener("loadedmetadata", function(){
      duration = clip.duration || 0;
      clip.pause();
      readScroll();
      seekAt = seekTo;
      try { clip.currentTime = seekAt; } catch (e) {}
    });
    clip.addEventListener("loadeddata", start);
    clip.addEventListener("canplaythrough", start);
    clip.addEventListener("error", start);
    clip.src = src;
    clip.load();
    setTimeout(start, 12000); // a stalled decode never strands the page behind the preloader
  }

  // Fetch the mp4 as a fully buffered blob first: seeking inside a buffered blob
  // is near instant, while range requests over the network make the scrub a slideshow.
  function preload(){
    var ctrl = window.AbortController ? new AbortController() : null;
    var bail = setTimeout(function(){
      if (!attached){
        if (ctrl) ctrl.abort();
        setProgress(1);
        attach(VIDEO_URL); // stream directly instead
      }
    }, 15000);

    fetch(VIDEO_URL, ctrl ? { signal: ctrl.signal } : undefined)
      .then(function(res){
        if (!res.ok || !res.body) throw new Error("fetch failed");
        var total = parseInt(res.headers.get("content-length"), 10) || 0;
        var reader = res.body.getReader();
        var chunks = [], got = 0;
        return new Promise(function(resolve, reject){
          (function pump(){
            reader.read().then(function(r){
              if (r.done){
                resolve(new Blob(chunks, { type: "video/mp4" }));
                return;
              }
              chunks.push(r.value);
              got += r.value.length;
              setProgress(total ? got / total : Math.min(got / 11e6, 0.95));
              pump();
            }).catch(reject);
          })();
        });
      })
      .then(function(blob){
        clearTimeout(bail);
        setProgress(1);
        attach(URL.createObjectURL(blob));
      })
      .catch(function(){
        // CORS failure, abort, or offline
        clearTimeout(bail);
        setProgress(1);
        attach(VIDEO_URL);
      });
  }

  // iOS will not paint a frame from a video that has never been played,
  // so nudge it once on the first interaction and pause immediately.
  function unlock(){
    var p = clip.play();
    if (p && p.then) p.then(function(){ clip.pause(); }).catch(function(){});
    else clip.pause();
  }
  ["touchstart","pointerdown","wheel","keydown"].forEach(function(ev){
    window.addEventListener(ev, unlock, { once:true, passive:true });
  });

  window.addEventListener("scroll", readScroll, { passive:true });
  window.addEventListener("resize", readScroll);

  readScroll();
  paint();
  preload();
  requestAnimationFrame(frame);
})();
