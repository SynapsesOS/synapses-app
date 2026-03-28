# Homebrew Cask for SynapsesOS
# Place in homebrew-tap repo as Casks/synapses.rb
# CI updates version and sha256 on each release.

cask "synapses" do
  version "0.8.0"

  on_arm do
    sha256 "PLACEHOLDER_ARM64_SHA256"
    url "https://github.com/SynapsesOS/synapses-app/releases/download/v#{version}/SynapsesOS_#{version}_aarch64.dmg"
  end

  on_intel do
    sha256 "PLACEHOLDER_X86_64_SHA256"
    url "https://github.com/SynapsesOS/synapses-app/releases/download/v#{version}/SynapsesOS_#{version}_x86_64.dmg"
  end

  name "SynapsesOS"
  desc "The nervous system for AI agents — code graph, memory, and coordination"
  homepage "https://synapsesos.com"

  # Install the app
  app "SynapsesOS.app"

  # Symlink the bundled CLI binary to /usr/local/bin/synapses
  binary "#{appdir}/SynapsesOS.app/Contents/Resources/synapses"

  zap trash: [
    "~/.synapses",
    "~/Library/LaunchAgents/com.synapsesos.daemon.plist",
  ]
end
