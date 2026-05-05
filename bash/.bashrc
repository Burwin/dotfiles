# If not running interactively, don't do anything (leave this at the top of this file)
[[ $- != *i* ]] && return

# All the default Omarchy aliases and functions
# (don't mess with these directly, just overwrite them here!)
source ~/.local/share/omarchy/default/bash/rc

# Add your own exports, aliases, and functions here.
#
# Make an alias for invoking commands you use constantly
# alias p='python'
PATH="$HOME/bin:$PATH"
PATH="$HOME/.dotnet/tools:$PATH"
PATH="$HOME/bin/JetBrains.Rider-2025.3.3/bin:$PATH"

# other configurations
export SSH_AUTH_SOCK="$XDG_RUNTIME_DIR/ssh-agent.socket"

# aliases
alias 1rm='_1rm'
alias v=nvim
alias lg=lazygit
alias ccs-list-secrets='~/src/secrets/ccs/list-secrets.sh'
alias ccs-secrets=ccs-list-secrets
alias xa='~/src/snippets/linux/close-all-except.sh'
alias sb='source ~/.bashrc'
alias rdp=xfreerdp3

# restart waybar
alias wb='systemctl --user restart waybar.service'

# sources
source ~/bin/1rm

# The next line updates PATH for the Google Cloud SDK.
if [ -f '/home/mbh/google-cloud-sdk/path.bash.inc' ]; then . '/home/mbh/google-cloud-sdk/path.bash.inc'; fi

# The next line enables shell command completion for gcloud.
if [ -f '/home/mbh/google-cloud-sdk/completion.bash.inc' ]; then . '/home/mbh/google-cloud-sdk/completion.bash.inc'; fi

# nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion

source /usr/share/nvm/init-nvm.sh

# rider background launcher
riderd() {
  nohup rider "$@" >/dev/null 2>&1 &
}

# music stations
alias classical='mpv https://live.ideastream.org/wclv.mp3'
alias catholic='mpv http://traditionalcatholicradio.org:8000/main'

# opencode
export PATH=/home/mbh/.opencode/bin:$PATH

# tmux
# Rename original Omarchy function so we can call it safely
eval "$(declare -f tdl | sed 's/^tdl/original_tdl/')"

tdl() {
    original_tdl "$@"
    sleep 0.7
    tmux resize-pane -t 0 -x 62%     # ← Change this number to adjust width
}
