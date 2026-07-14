export default defineContentScript({
  matches: ['https://*/*'],
  registration: 'runtime',
  main() {
    document.dispatchEvent(new CustomEvent('match-my-exp:content-ready'));
  },
});
