// Stand-in for the kernel's build output, checked in so that the dist/ branches of
// kernel-only-through-package-entries and kernel-testing-only-in-tests are exercised
// whether or not the real kernel has been built.
exports.isMinted = () => false;
