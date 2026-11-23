package PriceUpdater;

use strict;
use warnings;
use utf8;
use Exporter 'import';

our @EXPORT_OK = qw(parse_price_title);

sub parse_price_title {
  my ($region, $raw) = @_;
  return unless defined $raw;

  $raw =~ s/\x{FF08}/(/g;
  $raw =~ s/\x{FF09}/)/g;

  my $code_pattern;
  if ($region eq 'TCG_CORNER') {
    $code_pattern = qr/([A-Z0-9\/]{2,12}-AE[SC]?[A-Z0-9]{2,4})\s+(.*)/i;
  } elsif ($region eq 'PLAYERS_CLUB_AE') {
    $code_pattern = qr/([A-Z0-9\/]{2,12}-[A-Z]{2,5}[A-Z0-9]{1,6})\s*(.*)/i;
  } elsif ($region eq 'PLAYERS_CLUB_OCG') {
    $code_pattern = qr/([A-Z0-9\/]{2,12}-JP[A-Z0-9]{1,6})\s*(.*)/i;
  } else {
    return;
  }

  return unless $raw =~ /^\s*$code_pattern$/;
  my ($code, $rest) = (uc($1), $2);

  my $condition = '';
  $condition = uc($1) if $raw =~ /\(\s*Status\s*([A-Za-z])\s*\)/i;
  $condition = 'D' if !$condition && $raw =~ /damaged|\bDMG\b|played/i;

  my $without_status = $rest;
  $without_status =~ s/\(\s*Status[^)]*\)\s*//gi;
  $without_status =~ s/\s+$//;

  my $rarity = '';
  my $has_leading_rarity = 0;
  if ($region eq 'PLAYERS_CLUB_AE' &&
      $rest =~ s/^\s*\(\s*([A-Za-z0-9]+(?:\s*\/\s*[A-Za-z0-9]+)*)\s*\)\s*//) {
    $has_leading_rarity = 1;
    my $leading_rarity = $1;
    $rarity = $leading_rarity unless $leading_rarity =~ m{/};
  }
  if ($region eq 'PLAYERS_CLUB_OCG') {
    $rarity ||= $1 if $without_status =~ /\(\s*([A-Za-z][A-Za-z'’._\/ -]*(?:\s+[A-Za-z][A-Za-z'’._\/ -]*)*)\s*\)/;
  } elsif (!$has_leading_rarity) {
    $rarity ||= $1 if $without_status =~ /\(\s*([A-Za-z][A-Za-z'’._\/ -]*(?:\s+[A-Za-z][A-Za-z'’._\/ -]*)*)\s*\)\s*$/;
  }
  $rarity =~ s/^\s+|\s+$//g if $rarity;
  $rarity = uc($rarity) if $rarity;

  $rest =~ s/\(\s*Status[^)]*\)//gi;
  if ($region eq 'PLAYERS_CLUB_OCG') {
    $rest =~ s/\(\s*[A-Za-z][A-Za-z'’._\/ -]*(?:\s+[A-Za-z][A-Za-z'’._\/ -]*)*\s*\)//;
  } elsif ($region eq 'PLAYERS_CLUB_AE') {
    $rest =~ s/\(\s*[A-Za-z][A-Za-z'’._\/ -]*(?:\s+[A-Za-z][A-Za-z'’._\/ -]*)*\s*\)\s*$//
      unless $has_leading_rarity;
  } else {
    $rest =~ s/\(\s*[A-Za-z][A-Za-z'’._\/ -]*(?:\s+[A-Za-z][A-Za-z'’._\/ -]*)*\s*\)\s*$//;
  }
  $rest =~ s/\s+/ /g;
  $rest =~ s/^\s+|\s+$//g;

  return {
    code => $code,
    name => $rest,
    rarity => $rarity,
    condition => $condition
  };
}

1;
