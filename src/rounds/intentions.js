// One thing for today: the intention you take to the first tee and rate at the end. Most of the
// difference between a good round and a bad one is here, not in the swing.
export const INTENTIONS = [['commit', 'Commit to every target'], ['safe', 'Play the safe side'], ['routine', 'Routine on every shot'], ['present', 'One shot at a time'], ['club', 'Take enough club'], ['lag', 'Lag putts to the hole'], ['bogey', 'Bogey is fine, no doubles'], ['tempo', 'Smooth tempo']];
export const intentionLabel = (k) => (INTENTIONS.find((x) => x[0] === k) || [null, k])[1];
