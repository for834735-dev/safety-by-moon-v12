const LINK_REGEX = /(https?:\/\/|wa\.me\/|chat\.whatsapp\.com)/i;

function containsLink(text = '') {
  return LINK_REGEX.test(text);
}

module.exports = { containsLink };
