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

# other configurations
export SSH_AUTH_SOCK="$XDG_RUNTIME_DIR/ssh-agent.socket"

# aliases
alias 1rm='_1rm'
alias v=nvim
alias lg=lazygit
alias ccs-list-secrets='~/src/secrets/ccs/list-secrets.sh'
alias ccs-secrets=ccs-list-secrets

# sources
source ~/bin/1rm
