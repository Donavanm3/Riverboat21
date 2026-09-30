// Address of the online game server. The GitHub Pages site uses this to reach it.
// If your Render address is different, change it here (keep the quotes).
window.RB21_API = 'https://riverboat21.onrender.com';
// When the page is opened from the server itself, talk to it directly.
if (location.hostname.endsWith('onrender.com') || location.hostname === 'localhost' || location.hostname === '127.0.0.1') window.RB21_API = '';
