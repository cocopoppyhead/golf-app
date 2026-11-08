// Built-in drill for every fault the app measures. No API key needed.
// key = `${checkpoint}:${measure}` (face-on) or `dtl:${checkpoint}:${measure}` (down-the-line).

export const DRILLS = {
  // ---------- FACE-ON ----------
  'address:Ball position': {
    title: 'Club-on-the-ground ball position',
    why: 'Ball too far back gives low, blocked shots; too far forward gives pulls and thin contact.',
    steps: ['Lay a club across your toes and another pointing at the ball, at right angles.', 'Irons: ball in the middle to a ball forward of centre. Driver: inside the lead heel.', 'Set up to 10 balls checking the sticks each time before you hit.'],
    reps: '10 balls, every range session for a week', feel: 'Same spot, every time',
  },
  'address:Spine tilt': {
    title: 'Trail shoulder low',
    why: 'Without tilt away from the target you tend to get steep, over-the-top and pulled shots.',
    steps: ['Take your grip, then slide your trail hand down the thigh an inch.', 'Feel your trail shoulder sit lower than your lead shoulder and your head stay behind the ball.', 'Check in a mirror or phone: spine leans slightly away from target.'],
    reps: '10 set-ups without a ball, then 10 balls', feel: 'Trail shoulder lower than lead',
  },
  'address:Stance': {
    title: 'Shoulder-width stance check',
    why: 'Too narrow costs balance and speed; too wide stops the hips turning.',
    steps: ['Place two clubs on the ground pointing at the target, under the outside of each shoulder.', 'Irons: insides of your heels on the clubs. Driver: a little wider. Wedges: a little narrower.', 'Hit 10 balls without moving the clubs.'],
    reps: '10 balls per club type', feel: 'Stable, but able to turn',
  },
  'top:Head': {
    title: 'Head in the box',
    why: 'A big head move off the ball makes it hard to return the club to the same spot: fat and thin strikes.',
    steps: ['Stand with the sun or a light behind you so your head casts a shadow on a tee in the ground.', 'Make half swings keeping the shadow within a ball-width of the tee.', 'Build to full swings keeping it within two ball-widths.'],
    reps: '3 sets of 10 swings', feel: 'Turn around your head, not past it',
  },
  'top:Hips': {
    title: 'Trail-hip-to-wall',
    why: 'Sliding the hips past the trail foot means you have to slide back: inconsistent low point and blocks or hooks.',
    steps: ['Set up with your trail hip a few inches from a wall or golf bag.', 'Turn back so your trail hip moves back and around, not sideways into the wall.', 'Feel pressure in the inside of your trail foot at the top.'],
    reps: '3 sets of 10 slow turns, then 10 balls', feel: 'Turn in a barrel',
  },
  'top:Spine tilt': {
    title: 'Stay tilted at the top',
    why: 'Tilting toward the target at the top (reverse pivot) leads to steep downswings and weak slices.',
    steps: ['Hold a club across your chest. Make backswing turns.', 'At the top, the club across your chest should point down at the ground outside the ball, not level.', 'Feel your upper body stay behind the ball as you turn.'],
    reps: '20 turns, then 10 balls', feel: 'Head behind the ball at the top',
  },
  'impact:Hips': {
    title: 'Step-through drill',
    why: 'Hanging back on the trail side gives fat, thin and flippy strikes.',
    steps: ['Hit balls with half swings, letting your trail foot step toward the target after impact.', 'You can only step through if your weight has moved to the lead side.', 'Then hit full shots feeling the same shift without the step.'],
    reps: '10 step-throughs, then 10 normal', feel: 'Belt buckle moves toward target first',
  },
  'impact:Head': {
    title: 'Head behind the ball',
    why: 'Your head drifting toward the target at impact closes the shoulders and moves the low point: pulls, thin shots and lost speed.',
    steps: ['Put a headcover or towel just ahead of your lead eye line (toward target), on the ground in front of you.', 'Hit half shots keeping your head behind it through impact.', 'Stay there until the ball is gone, then let the head rotate.'],
    reps: '3 sets of 10 balls', feel: 'Hit it from behind the ball',
  },
  'impact:Spine tilt': {
    title: 'Trail shoulder under',
    why: 'Losing tilt in the downswing throws the club over the top: pulls and slices.',
    steps: ['Make slow downswings to impact and stop.', 'Check the trail shoulder is lower than the lead shoulder and your head is still behind the ball.', 'Hit balls with 3/4 swings holding that look.'],
    reps: '10 slow-motion rehearsals, then 10 balls', feel: 'Trail shoulder works down and under',
  },
  'impact:Hands': {
    title: 'Hands-ahead impact bag',
    why: 'Hands behind the ball adds loft and gives weak, high, inconsistent shots.',
    steps: ['Without a ball, swing slowly into an impact bag, pillow or the turf.', 'Arrive with the hands over your lead thigh and the shaft leaning toward the target.', 'Hit 3/4 shots trying to hit the ground after the ball.'],
    reps: '20 slow reps, then 10 balls', feel: 'Handle leads, clubhead follows',
  },
  'finish:Weight': {
    title: 'Hold your finish for 3 seconds',
    why: 'Falling back at the finish is a sign the weight never got to the lead side.',
    steps: ['Hit balls at 80% effort and hold the finish for a count of three.', 'Belt buckle to the target, almost all weight on the lead foot.', 'If you can\'t hold it, the swing was out of balance. Slow down.'],
    reps: '10 balls', feel: 'Pose for the photo',
  },
  'finish:Trail foot': {
    title: 'Trail toe finish',
    why: 'A flat trail foot at the finish means the hips stopped turning.',
    steps: ['At the finish, only the tip of your trail shoe should touch the ground.', 'Make practice swings finishing with the trail heel facing straight back.', 'Hit balls doing the same.'],
    reps: '10 swings, 10 balls', feel: 'Show your trail sole to someone behind you',
  },
  'finish:Body': {
    title: 'Chest to the target',
    why: 'Stopping the turn makes the arms flip the club: hooks and blocks.',
    steps: ['Pick a target. At the finish your chest and belt buckle should face it.', 'Make slow full swings and check with the club held across your chest.', 'Hit balls finishing the turn every time.'],
    reps: '10 balls', feel: 'Turn through, don\'t stop at the ball',
  },

  // ---------- DOWN-THE-LINE ----------
  'dtl:address:Posture': {
    title: 'Hinge from the hips',
    why: 'Too upright or too bent changes the swing plane and makes the body stand up through impact.',
    steps: ['Stand tall, hold a club down your spine touching head, upper back and backside.', 'Push your backside back and hinge until your arms hang straight under your shoulders, keeping all three contact points.', 'Add a little knee flex and grip the club.'],
    reps: '10 set-ups, then 10 balls', feel: 'Backside back, chest over the ball',
  },
  'dtl:address:Knee flex': {
    title: 'Athletic knees',
    why: 'Straight legs or too much squat both stop the hips turning properly.',
    steps: ['From good posture, flex the knees just enough that you could jump.', 'Knees over the balls of your feet, not past the toes.', 'Check side-on: a slight bend, not a sit.'],
    reps: '10 set-ups', feel: 'Ready to move',
  },
  'dtl:top:Spine angle': {
    title: 'Keep your angle going back',
    why: 'Standing up in the backswing changes the plane and you have to find the ball again.',
    steps: ['Set up with your head lightly touching a wall or alignment stick in front of you (cap brim).', 'Turn back keeping the brim on the stick.', 'Hit 3/4 shots feeling the same.'],
    reps: '20 turns, 10 balls', feel: 'Turn, don\'t lift',
  },
  'dtl:top:Head height': {
    title: 'Level head',
    why: 'Head dropping or rising in the backswing changes the low point: fat and thin strikes.',
    steps: ['Film side-on and put a finger on the screen on your cap.', 'Make swings keeping the cap within an inch of that spot to the top.', 'Hit balls the same way.'],
    reps: '10 swings, 10 balls', feel: 'Head stays at the same height',
  },
  'dtl:impact:Early extension': {
    title: 'Butt to the wall',
    why: 'Hips moving toward the ball in the downswing (early extension) leaves the arms no room: blocks, hooks, shanks and thin strikes.',
    steps: ['Set up with your backside lightly touching a wall, chair or golf bag behind you.', 'Swing back keeping the trail cheek on it, then down keeping the lead cheek on it through impact.', 'Hit 3/4 shots with the same feeling.'],
    reps: '3 sets of 10 swings, then 10 balls', feel: 'Backside stays back through the ball',
  },
  'dtl:impact:Spine angle': {
    title: 'Chest over the ball through impact',
    why: 'Standing up through impact pulls the club away from the ball: thin and blocked shots.',
    steps: ['Make slow swings to impact and freeze. Your chest should still be pointing at the ball.', 'Hit half shots keeping your chest down until the ball is gone.', 'Build to full speed.'],
    reps: '10 rehearsals, 10 balls', feel: 'Stay in your posture',
  },
  'dtl:impact:Head height': {
    title: 'No dip, no lift',
    why: 'Head moving up or down through impact changes how deep the club gets: fat and thin.',
    steps: ['Have a friend hold a club shaft just above your cap from side-on.', 'Swing without the cap touching it or dropping away from it.', 'Hit balls the same way.'],
    reps: '10 swings, 10 balls', feel: 'Quiet head',
  },
  'dtl:finish:Balance': {
    title: 'Tall balanced finish',
    why: 'Falling forward or back at the finish shows the swing was off balance.',
    steps: ['Hit balls at 80% and hold the finish for 3 seconds.', 'Finish tall, weight on the lead foot, chest to target.', 'If you wobble, slow down.'],
    reps: '10 balls', feel: 'Finish like a statue',
  },
};

export const drillFor = (key) => DRILLS[key] || null;

export function drillHtml(d, esc) {
  if (!d) return '';
  return `<div class="drill"><div class="lbl">Drill</div><b>${esc(d.title)}</b>
    <p class="mute small">${esc(d.why)}</p>
    <ol>${d.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    <p class="small"><b>Reps:</b> ${esc(d.reps)} · <b>Feel:</b> “${esc(d.feel)}”</p></div>`;
}
