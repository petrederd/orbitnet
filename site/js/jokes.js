/* ======== THE JOKES ========
   Each joke is a function. They run in order, one per press.
   After the last one, random lines from `late` take over.
   Want more absurdity? Add a new function at the end of `steps`. */
(function () {
  window.DPB = window.DPB || {};
  const U = DPB.ui, S = DPB.sound, st = DPB.state;
  const { say, toast, shake, sleep, progress, hideOverlay, btn } = U;
  const who = () => st.name || 'friend';

  const steps = [
    () => say("Um... it literally says DON'T press."),

    () => { say('Seriously? Again?'); toast('Achievement: First Disobedience'); S.play('win'); },

    () => { btn.textContent = "PLEASE DON'T PRESS"; say('Okay. Pretty please.'); },

    () => { btn.classList.add('small'); say('I got smaller. Now it is harder.'); },

    async () => {
      say('');
      const lines = ['Deleting System32...', 'Deleting your photos...', 'Deleting the internet...'];
      for (const l of lines) await progress(l, 1400);
      hideOverlay();
      say('Just kidding. Probably.');
      toast('Achievement: Survived the "deletion"');
      S.play('win');
    },

    // fake registration (see signup.js)
    async () => {
      say('Whoa, slow down. You need an account to keep going.');
      await sleep(1200);
      const name = await DPB.signup.open();
      say('Welcome, ' + name + '! Your account is totally real.');
      toast('Achievement: Registered for nothing');
      S.play('win');
    },

    async () => {
      btn.classList.add('sulk'); btn.textContent = 'offended';
      say("I'm not talking to you, " + who() + '.');
      S.play('sad');
      await sleep(4000);
      btn.classList.remove('sulk'); btn.textContent = "DON'T PRESS";
      say('Okay, I forgive you. But stop it.');
    },

    () => {
      shake(); S.play('whistle');
      say("ERROR 418: I'm a teapot. I refuse to be a button.");
      toast('Achievement: Brewed Tea');
    },

    () => { U.showCookie(); say('Wait, cookies first.'); },

    () => {
      say('Catch me if you can.');
      U.startRunaway(() => {
        say("Okay, I'm tired. Press me.");
        toast('Achievement: Button Hunter');
        S.play('win');
      });
    },

    async () => {
      say('');
      await progress('Updating website... 99%', 3500, true, 99);
      await sleep(1500);
      hideOverlay();
      say('Stuck. As usual.');
      S.play('error');
    },

    () => { document.body.classList.toggle('light'); say('Eye-burning mode enabled.'); },

    () => say('You pressed ' + st.clicks + ' times. The average human presses 3. You are not average.'),

    () => say('Fine, ' + who() + '. Press as much as you like. Nothing matters.')
  ];

  const late = [
    'Still pressing? Respect.',
    'The button is ticklish now.',
    'This will lead to nothing. Absolutely nothing.',
    'Somewhere, a single pixel just got sad.',
    'Your finger must be tired. Be kind to it.',
    'If I were you, I would do something useful. But I am a button.',
    'You will not win anything. You never will.',
    'Press recorded. Why? Unknown.',
    '{name}, have you eaten today?',
    'Press count is still going up. Science!'
  ];

  const lateEvents = [
    () => { shake(); S.play('boom'); },
    () => { toast('Achievement: Pointless Persistence (' + st.clicks + ')'); S.play('win'); },
    () => document.body.classList.toggle('light')
  ];

  DPB.jokes = { steps, late, lateEvents };
})();
