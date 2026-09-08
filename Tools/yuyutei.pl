#!/usr/bin/env perl

use strict;
use warnings;
use utf8;
use open qw(:std :encoding(UTF-8));

use LWP::UserAgent;
use HTTP::Request;
use JSON::PP qw(encode_json);
use URI;
use Time::HiRes qw(sleep);

# ============================================================
# YuYuTei Yu-Gi-Oh! OCG scraper for YGO-Collect
#
# Usage:
#   perl yuyutei.pl
#
# Output:
#   yuyutei.json
#
# The scraper:
#   1. Starts from YuYuTei Yu-Gi-Oh! set pages
#   2. Discovers /sell/ygo/card/... product URLs
#   3. Follows pagination
#   4. Scrapes each product page
#   5. Saves the results to yuyutei.json
# ============================================================

my $OUTPUT = 'yuyutei.json';

# Starting page.
my $START_URL = 'https://yuyu-tei.jp/sell/ygo/s/new';

# Delay between requests.
my $DELAY = 2.0;

# Maximum number of listing pages to crawl.
# Increase this if YuYuTei has more pagination than expected.
my $MAX_LISTING_PAGES = 500;

my $ua = LWP::UserAgent->new(
    agent => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36 YGO-Collect/1.0',
    timeout => 30,
    max_redirect => 5,
);

$ua->default_header(
    'Accept' =>
        'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
);

$ua->default_header(
    'Accept-Language' => 'ja,en-US;q=0.8,en;q=0.6'
);

$ua->default_header(
    'Cache-Control' => 'no-cache'
);

# ------------------------------------------------------------
# Clean HTML/text
# ------------------------------------------------------------

sub clean {
    my ($s) = @_;

    return '' unless defined $s;

    $s =~ s/&nbsp;/ /gi;
    $s =~ s/&#160;/ /g;
    $s =~ s/&amp;/&/gi;
    $s =~ s/&quot;/"/gi;
    $s =~ s/&#39;/'/g;
    $s =~ s/&#x27;/'/gi;
    $s =~ s/&lt;/</gi;
    $s =~ s/&gt;/>/gi;

    $s =~ s/&#(\d+);/chr($1)/ge;
    $s =~ s/&#x([0-9a-f]+);/chr(hex($1))/gei;

    $s =~ s/<script\b[^>]*>.*?<\/script>//gis;
    $s =~ s/<style\b[^>]*>.*?<\/style>//gis;
    $s =~ s/<[^>]+>/ /g;

    $s =~ s/\x{3000}/ /g;
    $s =~ s/[\r\n\t]+/ /g;
    $s =~ s/\s+/ /g;
    $s =~ s/^\s+|\s+$//g;

    return $s;
}

# ------------------------------------------------------------
# Meta tag
# ------------------------------------------------------------

sub meta {
    my ($html, $key) = @_;

    my $q = quotemeta($key);

    if (
        $html =~
        /<meta\b[^>]*(?:property|name)\s*=\s*["']$q["'][^>]*content\s*=\s*["']([^"']*)["'][^>]*>/is
    ) {
        return clean($1);
    }

    if (
        $html =~
        /<meta\b[^>]*content\s*=\s*["']([^"']*)["'][^>]*(?:property|name)\s*=\s*["']$q["'][^>]*>/is
    ) {
        return clean($1);
    }

    return '';
}

# ------------------------------------------------------------
# Regex helper
# ------------------------------------------------------------

sub first_capture {
    my ($html, @patterns) = @_;

    for my $re (@patterns) {
        if ($html =~ $re) {
            return clean($1);
        }
    }

    return '';
}

# ------------------------------------------------------------
# Product title and rarity
# ------------------------------------------------------------

sub title_and_rarity {
    my ($html) = @_;

    my $title = meta($html, 'og:title');

    $title = first_capture(
        $html,
        qr/<h1\b[^>]*>(.*?)<\/h1>/is
    ) unless $title;

    $title = first_capture(
        $html,
        qr/<title\b[^>]*>(.*?)<\/title>/is
    ) unless $title;

    my $rarity = '';

    # Examples:
    # UR 道化の一座 ハット
    # SR ...
    # QCSE ...
    if ($title =~ /^\s*(QCSE|QCSER|PSE|25th|20th|UR|SR|SE|SEC|CR|HR|GR|R|N|PR)\s+/i) {

        $rarity = uc($1);

        $title =~ s/^\s*\Q$1\E\s+//i;
    }

    $title =~ s/\s*\|\s*(?:販売|買取).*?$//;

    return (clean($title), $rarity);
}

# ------------------------------------------------------------
# Price
# ------------------------------------------------------------

sub price {
    my ($html) = @_;

    while (
        $html =~
        /([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)\s*(?:<[^>]*>\s*)*円/gi
    ) {
        my $p = $1;

        $p =~ s/,//g;

        return int($p);
    }

    return undef;
}

# ------------------------------------------------------------
# Yu-Gi-Oh card code
# ------------------------------------------------------------

sub card_code {
    my ($html) = @_;

    # Examples:
    # QCDB-JP001
    # INFO-JP001
    # YQ12-JP001

    if (
        $html =~
        /\b([A-Z0-9]{2,12}-JP[0-9A-Z]{1,12})\b/i
    ) {
        return uc($1);
    }

    return '';
}

# ------------------------------------------------------------
# Image
# ------------------------------------------------------------

sub image_url {
    my ($html, $url) = @_;

    my $img = meta($html, 'og:image');

    if (
        !$img &&
        $html =~ /<img\b[^>]*src\s*=\s*["']([^"']+)["']/is
    ) {
        $img = $1;
    }

    return '' unless $img;

    return URI->new_abs($img, $url)->as_string;
}

# ------------------------------------------------------------
# URL parts
# ------------------------------------------------------------

sub url_parts {
    my ($url) = @_;

    my ($set, $id) = ('', '');

    if (
        $url =~
        m{/sell/ygo/card/([^/]+)/([0-9]+)}i
    ) {
        ($set, $id) = (lc($1), $2);
    }

    return ($set, $id);
}

# ------------------------------------------------------------
# Stock
# ------------------------------------------------------------

sub stock {
    my ($html) = @_;

    if (
        $html =~
        /在庫.{0,500}?<input\b[^>]*value\s*=\s*["']([0-9]+)["']/is
    ) {
        return int($1);
    }

    if (
        $html =~
        /在庫\s*[：:]?[^0-9]{0,100}([0-9]+)\s*(?:個|枚)?/is
    ) {
        return int($1);
    }

    return undef;
}

# ============================================================
# Fetch a page
# ============================================================

sub fetch_page {
    my ($url) = @_;

    print "Fetching: $url\n";

    my $req = HTTP::Request->new(GET => $url);

    $req->header(
        'Referer' => 'https://yuyu-tei.jp/top/ygo'
    );

    my $res = $ua->request($req);

    unless ($res->is_success) {
        warn "HTTP error: " . $res->status_line . "\n";
        return;
    }

    my $html = $res->decoded_content(charset => 'none');

    utf8::decode($html)
        unless utf8::is_utf8($html);

    return $html;
}

# ============================================================
# Discover card URLs from a YuYuTei page
# ============================================================

sub discover_card_urls {
    my ($html, $base_url) = @_;

    my %urls;

    while (
        $html =~
        /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gis
    ) {

        my $href = $1;

        # Decode basic HTML entities.
        $href =~ s/&amp;/&/gi;

        # Ignore javascript/mailto/etc.
        next if $href =~ /^(?:javascript|mailto|tel):/i;

        my $absolute;

        eval {
            $absolute =
                URI->new_abs($href, $base_url)->as_string;
        };

        next unless $absolute;

        # Only YuYuTei Yu-Gi-Oh card product URLs.
        if (
            $absolute =~
            m{^https?://(?:www\.)?yuyu-tei\.jp/sell/ygo/card/[^/?#]+/[0-9]+(?:[?#].*)?$}i
        ) {

            # Remove query string and fragment.
            $absolute =~ s/[?#].*$//;

            $urls{$absolute} = 1;
        }
    }

    return keys %urls;
}

# ============================================================
# Discover pagination links
# ============================================================

sub discover_listing_urls {
    my ($html, $base_url) = @_;

    my %urls;

    while (
        $html =~
        /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>(.*?)<\/a>/gis
    ) {

        my ($href, $text) = ($1, $2);

        $href =~ s/&amp;/&/gi;

        next if $href =~ /^(?:javascript|mailto|tel):/i;

        my $absolute;

        eval {
            $absolute =
                URI->new_abs($href, $base_url)->as_string;
        };

        next unless $absolute;

        # YuYuTei Yu-Gi-Oh listing/set/search pages.
        next unless
            $absolute =~
            m{^https?://(?:www\.)?yuyu-tei\.jp/sell/ygo/s/}i;

        # Do not crawl unrelated external pages.
        $absolute =~ s/#.*$//;

        $urls{$absolute} = 1;
    }

    return keys %urls;
}

# ============================================================
# Scrape product
# ============================================================

sub scrape {
    my ($url) = @_;

    my $html = fetch_page($url);

    return unless $html;

    my ($name, $title_rarity) =
        title_and_rarity($html);

    my $rarity = $title_rarity;

    $rarity = first_capture(
        $html,

        qr/>\s*(QCSE|QCSER|PSE|25th|20th|UR|SR|SE|SEC|CR|HR|GR|R|N|PR)\s*</i,

        qr/\b(QCSE|QCSER|PSE|25th|20th|UR|SR|SE|SEC|CR|HR|GR|R|N|PR)\b/i
    ) unless $rarity;

    $rarity = uc($rarity)
        if $rarity;

    my ($set, $product_id) =
        url_parts($url);

    my $code  = card_code($html);
    my $sell  = price($html);
    my $image = image_url($html, $url);
    my $stock = stock($html);

    my %item = (
        name       => $name,
        cardCode   => $code,
        set        => $set,
        rarity     => $rarity,
        currency   => 'JPY',
        productId  => $product_id,
        image      => $image,
        url        => $url,
        source     => 'yuyu-tei',
    );

    $item{sellPrice} = $sell
        if defined $sell;

    $item{stock} = $stock
        if defined $stock;

    print "  Name: $item{name}\n";
    print "  Code: " .
        ($code || '(not found)') . "\n";

    print "  Rarity: " .
        ($rarity || '(not found)') . "\n";

    print "  Price: " .
        (defined($sell)
            ? "$sell JPY"
            : '(not found)') . "\n";

    print "  Stock: " .
        (defined($stock)
            ? $stock
            : '(not found)') . "\n\n";

    return \%item;
}

# ============================================================
# MAIN
# ============================================================

print "========================================\n";
print " YuYuTei Yu-Gi-Oh! Scraper\n";
print "========================================\n\n";

# ------------------------------------------------------------
# Phase 1:
# Discover YuYuTei set/listing pages
# ------------------------------------------------------------

my @queue = ($START_URL);

my %visited_listing;
my %card_urls;

my $listing_count = 0;

while (@queue && $listing_count < $MAX_LISTING_PAGES) {

    my $url = shift @queue;

    next if $visited_listing{$url}++;

    $listing_count++;

    print "\n";
    print "Listing page $listing_count\n";
    print "$url\n";

    my $html = fetch_page($url);

    unless ($html) {
        sleep $DELAY;
        next;
    }

    # Find product pages.
    my @found_cards =
        discover_card_urls($html, $url);

    for my $card_url (@found_cards) {
        $card_urls{$card_url} = 1;
    }

    print "  Card URLs found: "
        . scalar(@found_cards) . "\n";

    # Find other YuYuTei listing/set pages.
    my @found_listing =
        discover_listing_urls($html, $url);

    for my $listing_url (@found_listing) {

        next if $visited_listing{$listing_url};
        next if grep { $_ eq $listing_url } @queue;

        push @queue, $listing_url;
    }

    print "  Listing queue: "
        . scalar(@queue) . "\n";

    sleep $DELAY
        if @queue;
}

print "\n";
print "========================================\n";
print "URL discovery finished\n";
print "Listing pages visited: $listing_count\n";
print "Card URLs discovered: "
    . scalar(keys %card_urls) . "\n";
print "========================================\n\n";

die "No YuYuTei card URLs were discovered.\n"
    unless %card_urls;

# ------------------------------------------------------------
# Phase 2:
# Scrape discovered products
# ------------------------------------------------------------

my @urls = sort keys %card_urls;

my @data;

for my $i (0 .. $#urls) {

    my $url = $urls[$i];

    my $item;

    for my $attempt (1 .. 2) {

        $item = scrape($url);

        last if $item;

        if ($attempt == 1) {
            print "Retrying in 5 seconds...\n";
            sleep 5;
        }
    }

    push @data, $item
        if $item;

    sleep $DELAY
        if $i < $#urls;
}

# ------------------------------------------------------------
# Save JSON
# ------------------------------------------------------------

open my $out,
    '>:encoding(UTF-8)',
    $OUTPUT
    or die "Cannot write $OUTPUT: $!\n";

print $out
    JSON::PP->new
    ->utf8(0)
    ->pretty(1)
    ->canonical(1)
    ->encode(\@data);

close $out;

print "\n";
print "========================================\n";
print "Saved " . scalar(@data) . " records\n";
print "Output: $OUTPUT\n";
print "========================================\n";
