/** Select only an enumerated save; never construct or mutate a save path. */
function selectCheckSave(saves, directory) {
  if (!Array.isArray(saves) || saves.length === 0) throw new Error('No saves available for VR checks');
  if (directory === undefined) return 0;
  if (typeof directory !== 'string' || !directory.trim()) throw new Error('Save directory must be a non-empty string');
  const index = saves.findIndex(save => save && save.directory === directory);
  if (index < 0) throw new Error(`VR check save not found: ${directory}`);
  return index;
}

module.exports = { selectCheckSave };
